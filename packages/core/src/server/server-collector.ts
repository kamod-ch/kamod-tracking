import { prepareContractEnvelope, type ContractIngestOptions } from "../core/contract-ingest";
import { sanitizeForLog } from "../core/sanitize";
import type { IngestRejectReason } from "../core/types";
import { isJsonContentType, readBodyWithLimit } from "./request-guards";
import type { BatchEnvelopeAcceptance } from "./batch-contract";
import { eventIdFromOutboxId, type OutboxEventWriter, type OutboxTrackingRecord } from "./outbox";
import type { PublicIngestSite } from "./site-registry";

export type ServerCollectAuth =
  | { readonly kind: "static-token"; readonly token: string; readonly site: PublicIngestSite }
  | {
      readonly kind: "verify";
      verify(request: Request): Promise<{ ok: true; site: PublicIngestSite } | { ok: false }>;
    };

export type ServerCollectorOptions = {
  readonly auth: ServerCollectAuth;
  readonly createContractOptions: (site: PublicIngestSite) => ContractIngestOptions;
  readonly batchAcceptance: BatchEnvelopeAcceptance;
  readonly outboxWriter?: OutboxEventWriter;
};

export type ServerCollectHandler = (request: Request) => Promise<Response>;

export const createServerCollectHandler = (
  options: ServerCollectorOptions,
): ServerCollectHandler => {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return json({ ok: false, reason: "invalid-payload" }, 405);
    }
    const auth = await authorize(request, options.auth);
    if (!auth.ok) {
      return json({ ok: false, reason: "invalid-payload" }, 401);
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return json({ ok: false, reason: "invalid-payload" }, 400);
    }
    const bodyRead = await readBodyWithLimit(request, { maxBatchBytes: 65_536 });
    if (!bodyRead.ok) {
      return json({ ok: false, reason: "payload-too-large" }, 413);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bodyRead.bytes));
    } catch {
      return json({ ok: false, reason: "invalid-payload" }, 400);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, reason: "invalid-payload" }, 400);
    }
    const record = parsed as Record<string, unknown>;
    if (record.origin === "browser" || record.producer === "browser") {
      return json({ ok: false, reason: "producer-not-allowed" }, 403);
    }

    const outbox = parseOutboxRecord(record);
    if (!outbox.ok) {
      return json({ ok: false, reason: outbox.reason }, 400);
    }

    if (options.outboxWriter) {
      const written = await options.outboxWriter.write(outbox.record);
      if (!written.ok) {
        return json({ ok: false, reason: "storage-error", retryable: true }, 503);
      }
      return json(
        { ok: true, eventId: written.eventId, duplicate: written.duplicate, source: "outbox" },
        202,
      );
    }

    const contract = options.createContractOptions(auth.site);
    const eventId = eventIdFromOutboxId(outbox.record.outboxId);
    const submitted = {
      appId: auth.site.appId,
      id: eventId,
      name: outbox.record.eventName,
      schemaVersion: outbox.record.schemaVersion,
      origin: "server" as const,
      collectedAt: outbox.record.occurredAt,
      businessSubject: outbox.record.subject,
      properties: {
        ...outbox.record.properties,
        ...(outbox.record.pseudonymousAccountRef !== undefined
          ? { pseudonymous_account_ref: outbox.record.pseudonymousAccountRef }
          : {}),
      },
    };
    const prepared = await prepareContractEnvelope(contract, submitted);
    if (!prepared.ok) {
      return json({ ok: false, reason: prepared.reason }, statusFor(prepared.reason));
    }
    if (!prepared.envelope) {
      return json({ ok: false, reason: "invalid-payload" }, 400);
    }
    const stored = await options.batchAcceptance.acceptBatch([prepared.envelope]);
    if (!stored.ok) {
      return json({ ok: false, reason: "storage-error", retryable: true }, 503);
    }
    const outcome = stored.outcomes[0];
    return json(
      {
        ok: true,
        eventId: prepared.envelope.event_id,
        duplicate: outcome?.status === "accepted" ? outcome.duplicate : false,
      },
      202,
    );
  };
};

const authorize = async (
  request: Request,
  auth: ServerCollectAuth,
): Promise<{ ok: true; site: PublicIngestSite } | { ok: false }> => {
  if (auth.kind === "static-token") {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${auth.token}`) {
      return { ok: false };
    }
    return { ok: true, site: auth.site };
  }
  return auth.verify(request);
};

const parseOutboxRecord = (
  record: Record<string, unknown>,
): { ok: true; record: OutboxTrackingRecord } | { ok: false; reason: IngestRejectReason } => {
  const outboxId = asString(record.outboxId);
  const eventName = asString(record.eventName);
  const schemaVersion = asInt(record.schemaVersion);
  const occurredAt = asString(record.occurredAt);
  if (!outboxId || !eventName || schemaVersion === undefined || !occurredAt) {
    return { ok: false, reason: "invalid-payload" };
  }
  const subject = parseSubject(record.subject);
  if (!subject) {
    return { ok: false, reason: "invalid-payload" };
  }
  const properties = (asRecord(record.properties) ?? {}) as Readonly<
    Record<string, import("../core/types").JsonValue>
  >;
  const pseudonymousAccountRef = asOptionalString(record.pseudonymousAccountRef);
  return {
    ok: true,
    record: {
      outboxId,
      eventName,
      schemaVersion,
      occurredAt,
      subject,
      properties,
      ...(pseudonymousAccountRef !== undefined ? { pseudonymousAccountRef } : {}),
    },
  };
};

const parseSubject = (value: unknown) => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.objectType === "none") {
    return { objectType: "none" as const };
  }
  if (typeof record.objectType === "string" && typeof record.objectId === "string") {
    return { objectType: record.objectType, objectId: record.objectId };
  }
  return undefined;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const asInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;
const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const statusFor = (reason: IngestRejectReason): number => {
  if (reason === "producer-not-allowed") return 403;
  if (reason === "forbidden-producer-field") return 403;
  return 400;
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(sanitizeForLog(body)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
