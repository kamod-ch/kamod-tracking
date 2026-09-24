import {
  hasBusinessObjectId,
  type BusinessSubject,
  type CollectorContext,
  type OccurredAtTrust,
  type TrackingEventEnvelope,
} from "./envelope";
import { envelopesHaveSameDedupContent } from "./envelope-dedup";
import { hasForbiddenProducerFields } from "./producer-guard";
import type { EnvelopeStore } from "./envelope-store";
import { projectLegacyTrackingEvent } from "./legacy-projection";
import type { EventRegistry } from "./registry";
import { isIsoTimestamp, isValidObjectId } from "./schema-fields";
import { isCollectionAllowed, readConsentState, UNSPECIFIED_LEGAL_BASIS } from "./consent";
import { resolveEventCollectionPurpose } from "./collection-purpose";
import { toIso } from "./runtime";
import type {
  Clock,
  ConsentStore,
  EventOrigin,
  IdFactory,
  IngestResult,
  SubmittedEvent,
  TrustClass,
} from "./types";

const MAX_FUTURE_MS = 5 * 60_000;
const MAX_PAST_MS = 7 * 24 * 60 * 60_000;

export type ContractIngestOptions = {
  readonly appId: string;
  readonly registry: EventRegistry;
  readonly collector: CollectorContext;
  readonly envelopeStore: EnvelopeStore;
  readonly consents: ConsentStore;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly allowSession?: boolean;
};

const resolveSubmittedEventId = (
  submitted: SubmittedEvent,
  options: ContractIngestOptions,
):
  | { readonly ok: true; readonly eventId: string }
  | { readonly ok: false; readonly reason: "invalid-payload" } => {
  const eventId = submitted.id ?? options.ids?.eventId();
  if (eventId === undefined || !isValidObjectId(eventId)) {
    return { ok: false, reason: "invalid-payload" };
  }
  return { ok: true, eventId };
};

const reconcileWithStoredEnvelope = (
  existing: TrackingEventEnvelope,
  incoming: TrackingEventEnvelope,
): IngestResult => {
  if (!envelopesHaveSameDedupContent(existing, incoming)) {
    return { ok: false, reason: "payload-conflict" };
  }
  return envelopeIngestSuccess(existing);
};

export const ingestContractEvent = async (
  options: ContractIngestOptions,
  submitted: SubmittedEvent,
): Promise<IngestResult> => {
  if (submitted.rawProducerRecord && hasForbiddenProducerFields(submitted.rawProducerRecord)) {
    return { ok: false, reason: "forbidden-producer-field" };
  }
  if (submitted.appId !== options.appId) {
    return { ok: false, reason: "unknown-app" };
  }
  const schemaVersion = submitted.schemaVersion;
  if (schemaVersion === undefined) {
    return { ok: false, reason: "invalid-payload" };
  }
  const definition = options.registry.get(submitted.name, schemaVersion);
  if (!definition) {
    const hasEventName = options.registry
      .list()
      .some((entry) => entry.event_name === submitted.name);
    return { ok: false, reason: hasEventName ? "unknown-version" : "unknown-event" };
  }
  if (
    !options.registry.isReadable(submitted.name, schemaVersion, options.clock?.now() ?? new Date())
  ) {
    return { ok: false, reason: "version-retired" };
  }
  const producer = submitted.origin;
  if (!definition.producers.includes(producer)) {
    return { ok: false, reason: "producer-not-allowed" };
  }

  const eventIdResult = resolveSubmittedEventId(submitted, options);
  if (!eventIdResult.ok) {
    return eventIdResult;
  }
  const eventId = eventIdResult.eventId;
  const existing = await Promise.resolve(options.envelopeStore.get(eventId));
  if (existing) {
    const built = buildEnvelopeFromSubmitted(options, submitted, eventId);
    if (!built.ok) {
      return built;
    }
    return reconcileWithStoredEnvelope(existing, built.envelope);
  }

  const built = buildEnvelopeFromSubmitted(options, submitted, eventId);
  if (!built.ok) {
    return built;
  }

  await options.envelopeStore.append(built.envelope);
  return envelopeIngestSuccess(built.envelope);
};

export const prepareContractEnvelope = async (
  options: ContractIngestOptions,
  submitted: SubmittedEvent,
): Promise<IngestResult> => {
  if (submitted.rawProducerRecord && hasForbiddenProducerFields(submitted.rawProducerRecord)) {
    return { ok: false, reason: "forbidden-producer-field" };
  }
  if (submitted.appId !== options.appId) {
    return { ok: false, reason: "unknown-app" };
  }
  const schemaVersion = submitted.schemaVersion;
  if (schemaVersion === undefined) {
    return { ok: false, reason: "invalid-payload" };
  }
  const definition = options.registry.get(submitted.name, schemaVersion);
  if (!definition) {
    const hasEventName = options.registry
      .list()
      .some((entry) => entry.event_name === submitted.name);
    return { ok: false, reason: hasEventName ? "unknown-version" : "unknown-event" };
  }
  if (
    !options.registry.isReadable(submitted.name, schemaVersion, options.clock?.now() ?? new Date())
  ) {
    return { ok: false, reason: "version-retired" };
  }
  const producer = submitted.origin;
  if (!definition.producers.includes(producer)) {
    return { ok: false, reason: "producer-not-allowed" };
  }

  const eventIdResult = resolveSubmittedEventId(submitted, options);
  if (!eventIdResult.ok) {
    return eventIdResult;
  }
  const eventId = eventIdResult.eventId;
  const existing = await Promise.resolve(options.envelopeStore.get(eventId));
  if (existing) {
    const built = buildEnvelopeFromSubmitted(options, submitted, eventId);
    if (!built.ok) {
      return built;
    }
    return reconcileWithStoredEnvelope(existing, built.envelope);
  }

  const built = buildEnvelopeFromSubmitted(options, submitted, eventId);
  if (!built.ok) {
    return built;
  }
  return envelopeIngestSuccess(built.envelope);
};

type BuiltEnvelope = { readonly ok: true; readonly envelope: TrackingEventEnvelope };

const buildEnvelopeFromSubmitted = (
  options: ContractIngestOptions,
  submitted: SubmittedEvent,
  eventId: string,
): BuiltEnvelope | Extract<IngestResult, { ok: false }> => {
  const schemaVersion = submitted.schemaVersion;
  if (schemaVersion === undefined) {
    return { ok: false, reason: "invalid-payload" };
  }

  const propertiesResult = options.registry.validateProperties(
    submitted.name,
    schemaVersion,
    submitted.properties,
  );
  if (!propertiesResult.ok) {
    if (propertiesResult.reason === "payload-too-large") {
      return { ok: false, reason: "payload-too-large" };
    }
    return { ok: false, reason: "invalid-payload" };
  }

  const now = options.clock?.now() ?? new Date();
  const receivedAt = toIso(now);
  const occurredAt = submitted.collectedAt ?? receivedAt;
  if (!isIsoTimestamp(occurredAt) || !isIsoTimestamp(receivedAt)) {
    return { ok: false, reason: "invalid-payload" };
  }
  const occurredMs = Date.parse(occurredAt);
  const receivedMs = Date.parse(receivedAt);
  if (occurredMs > receivedMs + MAX_FUTURE_MS) {
    return { ok: false, reason: "invalid-payload" };
  }
  const producer = submitted.origin;
  let occurredAtTrust: OccurredAtTrust = "producer";
  if (producer === "browser" && occurredMs < receivedMs - MAX_PAST_MS) {
    occurredAtTrust = "adjusted";
  }

  const subject: BusinessSubject = submitted.businessSubject ?? { objectType: "none" };
  if (hasBusinessObjectId(subject) && !isValidObjectId(subject.objectId)) {
    return { ok: false, reason: "invalid-payload" };
  }

  const definition = options.registry.get(submitted.name, schemaVersion);
  if (!definition) {
    return { ok: false, reason: "unknown-event" };
  }

  const purpose = resolveEventCollectionPurpose(definition);
  if (producer === "browser" && submitted.purpose !== undefined && submitted.purpose !== purpose) {
    return { ok: false, reason: "invalid-payload" };
  }
  const consent = readConsentState(options.consents, submitted.appId, purpose);
  if (!isCollectionAllowed(consent, purpose)) {
    return { ok: false, reason: "consent-denied" };
  }

  const session =
    options.allowSession === true && submitted.session !== undefined
      ? submitted.session
      : undefined;
  if (session !== undefined && !isValidObjectId(session.sessionId)) {
    return { ok: false, reason: "invalid-payload" };
  }

  const envelope: TrackingEventEnvelope = {
    event_id: eventId,
    schema_version: schemaVersion,
    event_name: submitted.name,
    occurred_at: occurredAt,
    subject,
    properties: propertiesResult.properties as TrackingEventEnvelope["properties"],
    tenant_id: options.collector.tenantId,
    site_id: options.collector.siteId,
    received_at: receivedAt,
    producer,
    trust_class: trustForOrigin(producer),
    measurement_rule_version: options.collector.measurementRuleVersion,
    collection_policy_version: options.collector.collectionPolicyVersion,
    purpose,
    consent,
    legalBasis: submitted.legalBasis ?? UNSPECIFIED_LEGAL_BASIS,
    occurred_at_trust: occurredAtTrust,
    ...(session !== undefined ? { session } : {}),
  };

  return { ok: true, envelope };
};

const envelopeIngestSuccess = (envelope: TrackingEventEnvelope): IngestResult => ({
  ok: true,
  event: projectLegacyTrackingEvent(envelope),
  envelope,
  guarantee: "best-effort",
});

const trustForOrigin = (origin: EventOrigin): TrustClass =>
  origin === "browser" ? "untrusted" : "trusted";
