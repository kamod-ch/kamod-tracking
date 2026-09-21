import { hasForbiddenProducerFields, stripForbiddenProducerFields } from "../core/producer-guard";
import { sanitizeForLog } from "../core/sanitize";
import type { TrackingPipeline } from "../core/pipeline";
import type { BusinessSubject, CollectorContext } from "../core/envelope";
import type { IngestResult, LegalBasis, Purpose } from "../core/types";

export type IngestHandler = (request: Request) => Promise<Response>;

export type IngestHandlerOptions = {
  /**
   * Optional legal basis declared by the application for this endpoint.
   * Never read from the request body.
   */
  readonly legalBasis?: LegalBasis;
  readonly collector?: CollectorContext;
};

/**
 * Legacy single-event Fetch collector (non-contract payloads).
 * Prefer `createBrowserCollectHandler` for registry-backed batches.
 */
export const createIngestHandler = (
  pipeline: TrackingPipeline,
  options: IngestHandlerOptions = {},
): IngestHandler => {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return json({ ok: false, reason: "invalid-payload" }, 405);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: "invalid-payload" }, 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json({ ok: false, reason: "invalid-payload" }, 400);
    }
    const record = body as Record<string, unknown>;
    if (hasForbiddenProducerFields(record)) {
      return json({ ok: false, reason: "forbidden-producer-field" }, 403);
    }
    const cleaned = stripForbiddenProducerFields(record);
    const id = asOptionalString(cleaned.event_id) ?? asOptionalString(cleaned.id);
    const name = asOptionalString(cleaned.event_name) ?? asString(cleaned.name);
    const schemaVersion = asOptionalNumber(cleaned.schema_version);
    const purpose: Purpose | undefined = asPurpose(cleaned.purpose);
    const collectedAt =
      asOptionalString(cleaned.occurred_at) ?? asOptionalString(cleaned.collectedAt);
    const visitorId = asOptionalString(cleaned.visitorId);
    const channel = asOptionalString(cleaned.channel);
    const kind = asOptionalString(cleaned.kind);
    const properties = asRecord(cleaned.properties);
    const businessSubject = parseSubject(cleaned.subject);
    const session = parseSession(cleaned.session);
    const submitted = {
      appId: asString(cleaned.appId),
      name,
      origin: "browser" as const,
      rawProducerRecord: record,
      ...(id !== undefined ? { id } : {}),
      ...(schemaVersion !== undefined ? { schemaVersion } : {}),
      ...(purpose !== undefined ? { purpose } : {}),
      ...(collectedAt !== undefined ? { collectedAt } : {}),
      ...(visitorId !== undefined ? { visitorId } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(properties !== undefined ? { properties } : {}),
      ...(businessSubject !== undefined ? { businessSubject } : {}),
      ...(session !== undefined ? { session } : {}),
      ...(options.legalBasis !== undefined ? { legalBasis: options.legalBasis } : {}),
    };
    void options.collector;
    const result: IngestResult = await pipeline.ingest(submitted);
    if (!result.ok) {
      return json({ ok: false, reason: result.reason }, statusFor(result.reason));
    }
    return json(
      {
        ok: true,
        id: result.envelope?.event_id ?? result.event.id,
        guarantee: result.guarantee,
        origin: result.event.origin,
        trust: result.event.trust,
        tenant_id: result.envelope?.tenant_id,
      },
      202,
    );
  };
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(sanitizeForLog(body)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const asPurpose = (value: unknown) => {
  if (value === "necessary" || value === "analytics" || value === "measurement") {
    return value;
  }
  return undefined;
};

const parseSubject = (value: unknown): BusinessSubject | undefined => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.objectType === "none") {
    return { objectType: "none" };
  }
  if (typeof record.objectType === "string" && typeof record.objectId === "string") {
    return { objectType: record.objectType, objectId: record.objectId };
  }
  return undefined;
};

const parseSession = (value: unknown) => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const sessionId = (value as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== "string") {
    return undefined;
  }
  return { sessionId };
};

const statusFor = (reason: string): number => {
  if (reason === "unknown-app") return 404;
  if (reason === "audit-event") return 409;
  if (reason === "forbidden-producer-field") return 403;
  if (reason === "identity-not-allowed") return 403;
  return 400;
};
