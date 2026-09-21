import { validateBrowserIdentityAgainstPolicy } from "../core/capture-policy";
import { prepareContractEnvelope, type ContractIngestOptions } from "../core/contract-ingest";
import { hasForbiddenProducerFields } from "../core/producer-guard";
import type { EventRegistry } from "../core/registry";
import { sanitizeForLog } from "../core/sanitize";
import type { IngestRejectReason, SubmittedEvent } from "../core/types";
import type { BusinessSubject } from "../core/envelope";
import {
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_MAX_BATCH_EVENTS,
  type BatchCollectResponse,
  type BatchEnvelopeAcceptance,
  type BatchEventOutcome,
  type CollectorLimits,
  resolveCollectorLimits,
} from "./batch-contract";
import {
  corsPreflightResponse,
  isJsonContentType,
  isOriginAllowed,
  parsePublicKeyFromPath,
  readBodyWithLimit,
} from "./request-guards";
import type { RateLimiter } from "./rate-limit";
import type { PublicIngestSite, SiteRegistry } from "./site-registry";
import { clientIpForRateLimit, type TrustedProxyOptions } from "./trusted-proxy";

const BROWSER_FORBIDDEN_CLAIMS = [
  "accountId",
  "origin",
  "producer",
  "trust_class",
  "tenant_id",
  "site_id",
] as const;

export type BrowserCollectorOptions = {
  readonly sites: SiteRegistry;
  readonly registry: EventRegistry;
  readonly createContractOptions: (site: PublicIngestSite) => ContractIngestOptions;
  readonly batchAcceptance: BatchEnvelopeAcceptance;
  readonly limits?: CollectorLimits;
  readonly rateLimiter?: RateLimiter;
  readonly trustedProxy?: TrustedProxyOptions;
  /** When false, resolve site from body appId (legacy). Default true uses /v1/collect/:publicKey. */
  readonly requirePublicKey?: boolean;
};

export type BrowserCollectHandler = (request: Request) => Promise<Response>;

export const createBrowserCollectHandler = (
  options: BrowserCollectorOptions,
): BrowserCollectHandler => {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      const key = parsePublicKeyFromPath(new URL(request.url).pathname);
      const site = key ? options.sites.resolveByPublicKey(key) : undefined;
      return corsPreflightResponse(site?.allowedOrigins ?? []);
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, reason: "invalid-payload" }, 405);
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return jsonResponse({ ok: false, reason: "invalid-payload" }, 400);
    }

    const bodyRead = await readBodyWithLimit(request, options.limits);
    if (!bodyRead.ok) {
      return jsonResponse({ ok: false, reason: "payload-too-large" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bodyRead.bytes));
    } catch {
      return jsonResponse({ ok: false, reason: "invalid-payload" }, 400);
    }

    const site = resolveSite(request, parsed, options);
    if (!site) {
      return jsonResponse({ ok: false, reason: "invalid-payload" }, 404);
    }

    if (!isOriginAllowed(request, site.allowedOrigins)) {
      return jsonResponse({ ok: false, reason: "invalid-payload" }, 403);
    }

    if (options.rateLimiter) {
      const decision = options.rateLimiter.check(
        buildRateLimitKey(request, site, options.trustedProxy),
      );
      if (!decision.allowed) {
        return jsonResponse({ ok: false, reason: "rate-limited", retryable: true }, 429, {
          "retry-after": String(decision.retryAfterSeconds),
        });
      }
    }

    const items = extractBatchItems(parsed, options.limits);
    if (!items.ok) {
      return jsonResponse({ ok: false, reason: items.reason }, items.status);
    }

    const contract = options.createContractOptions(site);
    const outcomes: BatchEventOutcome[] = [];
    const envelopes: import("../core/envelope").TrackingEventEnvelope[] = [];

    for (const rawItem of items.items) {
      const prepared = prepareBrowserSubmitted(rawItem, site, options.registry);
      if (!prepared.ok) {
        outcomes.push({
          event_id: prepared.eventId,
          status: "rejected",
          reason: prepared.reason,
        });
        continue;
      }

      const identityReject = validateBrowserIdentityAgainstPolicy({
        allowedModes: site.collector.allowedBrowserIdentityModes ?? [site.browserIdentityMode],
        configuredMode: site.collector.browserIdentityMode ?? site.browserIdentityMode,
        submitted: prepared.submitted,
      });
      if (identityReject) {
        outcomes.push({
          event_id: prepared.eventId,
          status: "rejected",
          reason: identityReject,
        });
        continue;
      }

      const result = await prepareContractEnvelope(contract, prepared.submitted);
      if (!result.ok) {
        outcomes.push({
          event_id: prepared.eventId,
          status: "rejected",
          reason: result.reason,
        });
        continue;
      }
      if (!result.envelope) {
        outcomes.push({
          event_id: prepared.eventId,
          status: "rejected",
          reason: "invalid-payload",
        });
        continue;
      }
      if (result.envelope.tenant_id !== site.tenantId || result.envelope.site_id !== site.siteId) {
        outcomes.push({
          event_id: prepared.eventId,
          status: "rejected",
          reason: "unknown-app",
        });
        continue;
      }
      const alreadyStored = await Promise.resolve(
        contract.envelopeStore.get(result.envelope.event_id),
      );
      if (alreadyStored) {
        outcomes.push({
          event_id: prepared.eventId,
          status: "accepted",
          duplicate: true,
        });
        continue;
      }
      envelopes.push(result.envelope);
      outcomes.push({
        event_id: prepared.eventId,
        status: "accepted",
        duplicate: false,
      });
    }

    if (envelopes.length === 0) {
      return jsonResponse({ ok: true, outcomes }, 202);
    }

    const stored = await options.batchAcceptance.acceptBatch(envelopes);
    if (!stored.ok) {
      return jsonResponse({ ok: false, reason: "storage-error", retryable: true }, 503, {
        "retry-after": "5",
      });
    }

    return jsonResponse({ ok: true, outcomes: mergeOutcomes(outcomes, stored.outcomes) }, 202);
  };
};

const mergeOutcomes = (
  prepared: BatchEventOutcome[],
  stored: readonly BatchEventOutcome[],
): BatchEventOutcome[] => {
  const storedById = new Map(
    stored.filter((e) => e.status === "accepted").map((entry) => [entry.event_id, entry]),
  );
  return prepared.map((entry) => {
    if (entry.status === "rejected") {
      return entry;
    }
    const persisted = storedById.get(entry.event_id);
    if (persisted && persisted.status === "accepted") {
      return persisted;
    }
    return entry;
  });
};

const resolveSite = (
  request: Request,
  parsed: unknown,
  options: BrowserCollectorOptions,
): PublicIngestSite | undefined => {
  const requireKey = options.requirePublicKey !== false;
  if (requireKey) {
    const key = parsePublicKeyFromPath(new URL(request.url).pathname);
    if (!key) {
      return undefined;
    }
    return options.sites.resolveByPublicKey(key);
  }
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const appId = (parsed as { appId?: unknown }).appId;
  if (typeof appId !== "string") {
    return undefined;
  }
  return options.sites.resolveByAppId(appId);
};

const extractBatchItems = (
  parsed: unknown,
  limits: CollectorLimits | undefined,
):
  | { ok: true; items: Record<string, unknown>[] }
  | { ok: false; reason: "invalid-payload" | "payload-too-large"; status: number } => {
  const { maxBatchEvents, maxBatchBytes } = resolveCollectorLimits(limits);
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, reason: "invalid-payload", status: 400 };
  }
  const record = parsed as Record<string, unknown>;
  const eventsRaw = record.events ?? record.batch;
  if (Array.isArray(eventsRaw)) {
    if (eventsRaw.length > maxBatchEvents) {
      return { ok: false, reason: "payload-too-large", status: 413 };
    }
    const items = eventsRaw.filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry),
    );
    if (items.length !== eventsRaw.length) {
      return { ok: false, reason: "invalid-payload", status: 400 };
    }
    return { ok: true, items };
  }
  const singleSize = JSON.stringify(record).length;
  if (singleSize > maxBatchBytes) {
    return { ok: false, reason: "payload-too-large", status: 413 };
  }
  return { ok: true, items: [record] };
};

const prepareBrowserSubmitted = (
  raw: Record<string, unknown>,
  site: PublicIngestSite,
  registry: EventRegistry,
):
  | { ok: true; submitted: SubmittedEvent; eventId: string }
  | { ok: false; eventId: string; reason: IngestRejectReason } => {
  if (hasForbiddenProducerFields(raw) || hasBrowserForbiddenClaims(raw)) {
    return { ok: false, eventId: readEventId(raw), reason: "forbidden-producer-field" };
  }
  const eventId = readEventId(raw);
  const name =
    typeof raw.event_name === "string"
      ? raw.event_name
      : typeof raw.name === "string"
        ? raw.name
        : "";
  const schemaVersion =
    typeof raw.schema_version === "number" && Number.isInteger(raw.schema_version)
      ? raw.schema_version
      : undefined;
  if (!name || schemaVersion === undefined) {
    return { ok: false, eventId, reason: "invalid-payload" };
  }
  const definition = registry.get(name, schemaVersion);
  if (!definition || !definition.producers.includes("browser")) {
    return {
      ok: false,
      eventId,
      reason: definition ? "producer-not-allowed" : "unknown-event",
    };
  }

  const businessSubject = parseSubject(raw.subject);
  const session = parseSession(raw.session);
  const properties = asRecord(raw.properties);
  const collectedAt =
    typeof raw.occurred_at === "string"
      ? raw.occurred_at
      : typeof raw.collectedAt === "string"
        ? raw.collectedAt
        : undefined;
  const submitted: SubmittedEvent = {
    appId: site.appId,
    name,
    schemaVersion,
    origin: "browser",
    rawProducerRecord: raw,
    id: eventId,
    ...(collectedAt !== undefined ? { collectedAt } : {}),
    ...(businessSubject !== undefined ? { businessSubject } : {}),
    ...(session !== undefined ? { session } : {}),
    ...(properties !== undefined ? { properties } : {}),
  };
  return { ok: true, submitted, eventId };
};

const hasBrowserForbiddenClaims = (record: Record<string, unknown>): boolean =>
  BROWSER_FORBIDDEN_CLAIMS.some((field) => record[field] !== undefined);

const readEventId = (raw: Record<string, unknown>): string => {
  if (typeof raw.event_id === "string") {
    return raw.event_id;
  }
  if (typeof raw.id === "string") {
    return raw.id;
  }
  return "unknown";
};

const buildRateLimitKey = (
  request: Request,
  site: PublicIngestSite,
  trustedProxy?: TrustedProxyOptions,
): string => {
  const ip = clientIpForRateLimit(request, trustedProxy);
  return ip ? `${site.publicKey}:${ip}` : site.publicKey;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
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

const jsonResponse = (
  body: BatchCollectResponse | { ok: false; reason: string; retryable?: boolean },
  status: number,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(sanitizeForLog(body)), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

export { DEFAULT_MAX_BATCH_BYTES, DEFAULT_MAX_BATCH_EVENTS };
