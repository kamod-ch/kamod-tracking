import { isAuditEvent } from "./audit-boundary";
import { isCollectionAllowed, readConsentState, UNSPECIFIED_LEGAL_BASIS } from "./consent";
import { toIso } from "./runtime";
import { sanitizePath, sanitizeProperties } from "./sanitize";
import { resolveCaptureIdentity } from "./config";
import { validateBrowserIdentityAgainstPolicy, type CaptureIdentityMode } from "./capture-policy";
import type { CollectorContext } from "./envelope";
import { ingestContractEvent, type ContractIngestOptions } from "./contract-ingest";
import type { EnvelopeStore } from "./envelope-store";
import type { EventRegistry } from "./registry";
import type {
  Clock,
  ConsentStore,
  CustomEventInput,
  EventOrigin,
  EventStore,
  EventSubject,
  IdFactory,
  IngestResult,
  LegalBasis,
  PageViewInput,
  Purpose,
  ServerConversionInput,
  SubmittedEvent,
  TimeBounds,
  TrackingEvent,
  TrustClass,
} from "./types";

export type TrackingPipelineOptions = {
  readonly appId: string;
  readonly store: EventStore;
  readonly consents: ConsentStore;
  readonly identityMode?: CaptureIdentityMode;
  /** @deprecated Use `identityMode`. */
  readonly visitorIdentity?: import("./config").VisitorIdentityMode;
  readonly collectorPolicy?: Pick<
    CollectorContext,
    "allowedBrowserIdentityModes" | "browserIdentityMode"
  >;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly registry?: EventRegistry;
  readonly collector?: CollectorContext;
  readonly envelopeStore?: EnvelopeStore;
  readonly allowSession?: boolean;
};

export type TrackingPipeline = {
  ingest(submitted: SubmittedEvent): Promise<IngestResult>;
  pageView(input: PageViewInput): Promise<IngestResult>;
  track(input: CustomEventInput): Promise<IngestResult>;
  recordConversion(input: ServerConversionInput): Promise<IngestResult>;
};

export const createTrackingPipeline = (options: TrackingPipelineOptions): TrackingPipeline => {
  const contractOptions: ContractIngestOptions | undefined =
    options.registry && options.collector && options.envelopeStore
      ? {
          appId: options.appId,
          registry: options.registry,
          collector: options.collector,
          envelopeStore: options.envelopeStore,
          consents: options.consents,
          ...(options.clock !== undefined ? { clock: options.clock } : {}),
          ...(options.ids !== undefined ? { ids: options.ids } : {}),
          ...(options.allowSession !== undefined ? { allowSession: options.allowSession } : {}),
        }
      : undefined;

  const ingest = async (submitted: SubmittedEvent): Promise<IngestResult> => {
    if (contractOptions && submitted.schemaVersion !== undefined) {
      return ingestContractEvent(contractOptions, submitted);
    }
    if (submitted.appId !== options.appId) {
      return { ok: false, reason: "unknown-app" };
    }
    if (isAuditEvent(submitted)) {
      return { ok: false, reason: "audit-event" };
    }
    if (submitted.id !== undefined) {
      if (!isValidEventId(submitted.id)) {
        return { ok: false, reason: "invalid-payload" };
      }
      const existing = options.store.get(submitted.id);
      if (existing) {
        return { ok: true, event: existing, guarantee: "best-effort" };
      }
    }
    if (!isValidName(submitted.name)) {
      return { ok: false, reason: "invalid-payload" };
    }
    if (submitted.visitorId !== undefined && submitted.accountId !== undefined) {
      return { ok: false, reason: "identity-link-forbidden" };
    }

    const origin = submitted.origin;
    const trust = trustForOrigin(origin);
    if (submitted.origin === "browser" && trust !== "untrusted") {
      return { ok: false, reason: "trust-mismatch" };
    }
    if (submitted.origin === "server" && trust !== "trusted") {
      return { ok: false, reason: "trust-mismatch" };
    }
    if (origin === "browser" && submitted.accountId !== undefined) {
      return { ok: false, reason: "identity-link-forbidden" };
    }

    const purpose = submitted.purpose ?? defaultPurpose(submitted.name, origin);
    const consent = readConsentState(options.consents, submitted.appId, purpose);
    if (!isCollectionAllowed(consent, purpose)) {
      return { ok: false, reason: "consent-denied" };
    }

    const identityMode = resolveCaptureIdentity(options);
    const collectorPolicy = options.collectorPolicy ?? contractOptions?.collector ?? undefined;
    if (origin === "browser" && collectorPolicy) {
      const allowed =
        collectorPolicy.allowedBrowserIdentityModes ??
        ([identityMode] as readonly CaptureIdentityMode[]);
      const configured = collectorPolicy.browserIdentityMode ?? identityMode;
      const identityReject = validateBrowserIdentityAgainstPolicy({
        allowedModes: allowed,
        configuredMode: configured,
        submitted,
      });
      if (identityReject) {
        return { ok: false, reason: identityReject };
      }
    }

    const sanitized = sanitizeProperties(submitted.properties);
    if (!sanitized.ok) {
      return { ok: false, reason: sanitized.reason };
    }

    const now = options.clock?.now() ?? new Date();
    const receivedAt = toIso(now);
    const collectedAt = submitted.collectedAt ?? receivedAt;
    if (!isIsoTimestamp(collectedAt) || !isIsoTimestamp(receivedAt)) {
      return { ok: false, reason: "invalid-payload" };
    }
    if (Date.parse(collectedAt) > Date.parse(receivedAt) + 5 * 60_000) {
      return { ok: false, reason: "invalid-payload" };
    }

    const timeBounds = normalizeTimeBounds(submitted.timeBounds);
    const legalBasis: LegalBasis = submitted.legalBasis ?? UNSPECIFIED_LEGAL_BASIS;
    const subject = subjectFrom(submitted);
    const session =
      identityMode === "session" && submitted.session !== undefined ? submitted.session : undefined;
    const event: TrackingEvent = {
      id: submitted.id ?? options.ids?.eventId() ?? globalThis.crypto.randomUUID(),
      name: submitted.name,
      purpose,
      origin,
      trust,
      consent,
      legalBasis,
      collectedAt,
      receivedAt,
      timeBounds,
      appId: submitted.appId,
      subject,
      ...(session !== undefined ? { session } : {}),
      properties: sanitized.properties,
    };

    await options.store.append(event);
    return { ok: true, event, guarantee: "best-effort" };
  };

  return {
    ingest,
    pageView(input) {
      return ingest({
        appId: input.appId,
        name: "page_view",
        purpose: "analytics",
        origin: "browser",
        ...(input.collectedAt !== undefined ? { collectedAt: input.collectedAt } : {}),
        ...(input.timeBounds !== undefined ? { timeBounds: input.timeBounds } : {}),
        ...(input.legalBasis !== undefined ? { legalBasis: input.legalBasis } : {}),
        properties: { ...input.properties, path: sanitizePath(input.path) },
      });
    },
    track(input) {
      return ingest({
        appId: input.appId,
        name: input.name,
        purpose: input.purpose ?? "analytics",
        origin: "browser",
        ...(input.collectedAt !== undefined ? { collectedAt: input.collectedAt } : {}),
        ...(input.timeBounds !== undefined ? { timeBounds: input.timeBounds } : {}),
        ...(input.legalBasis !== undefined ? { legalBasis: input.legalBasis } : {}),
        ...(input.properties !== undefined ? { properties: input.properties } : {}),
      });
    },
    recordConversion(input) {
      return ingest({
        appId: input.appId,
        name: input.name,
        purpose: "measurement",
        origin: "server",
        ...(input.collectedAt !== undefined ? { collectedAt: input.collectedAt } : {}),
        ...(input.timeBounds !== undefined ? { timeBounds: input.timeBounds } : {}),
        ...(input.legalBasis !== undefined ? { legalBasis: input.legalBasis } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.properties !== undefined ? { properties: input.properties } : {}),
      });
    },
  };
};

const trustForOrigin = (origin: EventOrigin): TrustClass =>
  origin === "browser" ? "untrusted" : "trusted";

const defaultPurpose = (name: string, origin: EventOrigin): Purpose => {
  if (origin === "server" || name === "conversion") return "measurement";
  return "analytics";
};

const isValidName = (name: string): boolean => /^[a-z][a-z0-9_]{1,63}$/.test(name);

const isValidEventId = (id: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(id);

const isIsoTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));

const normalizeTimeBounds = (bounds: TimeBounds | undefined): TimeBounds => {
  if (!bounds) return {};
  const timeBounds: TimeBounds = {};
  if (bounds.windowStart !== undefined) {
    Object.assign(timeBounds, { windowStart: bounds.windowStart });
  }
  if (bounds.windowEnd !== undefined) {
    Object.assign(timeBounds, { windowEnd: bounds.windowEnd });
  }
  return timeBounds;
};

const subjectFrom = (submitted: SubmittedEvent): EventSubject => {
  if (submitted.accountId !== undefined) {
    return { type: "account", accountId: submitted.accountId };
  }
  return { type: "none" };
};
