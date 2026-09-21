import type { TrackingEventEnvelope } from "./envelope";
import type { JsonValue } from "./types";

export type SerializedTrackingEvent = {
  readonly event_id: string;
  readonly schema_version: number;
  readonly event_name: string;
  readonly occurred_at: string;
  readonly subject: TrackingEventEnvelope["subject"];
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly session?: TrackingEventEnvelope["session"];
  readonly tenant_id: string;
  readonly site_id: string;
  readonly received_at: string;
  readonly producer: TrackingEventEnvelope["producer"];
  readonly trust_class: TrackingEventEnvelope["trust_class"];
  readonly measurement_rule_version: string;
  readonly collection_policy_version: string;
  readonly purpose: TrackingEventEnvelope["purpose"];
  readonly consent: TrackingEventEnvelope["consent"];
  readonly legalBasis: TrackingEventEnvelope["legalBasis"];
  readonly occurred_at_trust: TrackingEventEnvelope["occurred_at_trust"];
};

export const serializeTrackingEvent = (event: TrackingEventEnvelope): SerializedTrackingEvent => ({
  event_id: event.event_id,
  schema_version: event.schema_version,
  event_name: event.event_name,
  occurred_at: event.occurred_at,
  subject: event.subject,
  properties: event.properties,
  ...(event.session !== undefined ? { session: event.session } : {}),
  tenant_id: event.tenant_id,
  site_id: event.site_id,
  received_at: event.received_at,
  producer: event.producer,
  trust_class: event.trust_class,
  measurement_rule_version: event.measurement_rule_version,
  collection_policy_version: event.collection_policy_version,
  purpose: event.purpose,
  consent: event.consent,
  legalBasis: event.legalBasis,
  occurred_at_trust: event.occurred_at_trust,
});

export const deserializeTrackingEvent = (input: unknown): TrackingEventEnvelope | undefined => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const requiredStrings = [
    "event_id",
    "event_name",
    "occurred_at",
    "received_at",
    "tenant_id",
    "site_id",
    "measurement_rule_version",
    "collection_policy_version",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof record[key] !== "string") {
      return undefined;
    }
  }
  if (typeof record.schema_version !== "number") {
    return undefined;
  }
  if (record.producer !== "browser" && record.producer !== "server") {
    return undefined;
  }
  if (record.trust_class !== "untrusted" && record.trust_class !== "trusted") {
    return undefined;
  }
  if (record.occurred_at_trust !== "producer" && record.occurred_at_trust !== "adjusted") {
    return undefined;
  }
  if (record.subject === null || typeof record.subject !== "object") {
    return undefined;
  }
  if (
    record.properties === null ||
    typeof record.properties !== "object" ||
    Array.isArray(record.properties)
  ) {
    return undefined;
  }
  const envelope: TrackingEventEnvelope = {
    event_id: record.event_id as string,
    schema_version: record.schema_version,
    event_name: record.event_name as string,
    occurred_at: record.occurred_at as string,
    subject: record.subject as TrackingEventEnvelope["subject"],
    properties: record.properties as Readonly<Record<string, JsonValue>>,
    tenant_id: record.tenant_id as string,
    site_id: record.site_id as string,
    received_at: record.received_at as string,
    producer: record.producer,
    trust_class: record.trust_class,
    measurement_rule_version: record.measurement_rule_version as string,
    collection_policy_version: record.collection_policy_version as string,
    purpose: record.purpose as TrackingEventEnvelope["purpose"],
    consent: record.consent as TrackingEventEnvelope["consent"],
    legalBasis: record.legalBasis as TrackingEventEnvelope["legalBasis"],
    occurred_at_trust: record.occurred_at_trust,
  };
  if (record.session !== undefined) {
    if (
      record.session === null ||
      typeof record.session !== "object" ||
      typeof (record.session as { sessionId?: unknown }).sessionId !== "string"
    ) {
      return undefined;
    }
    return {
      ...envelope,
      session: { sessionId: (record.session as { sessionId: string }).sessionId },
    };
  }
  return envelope;
};
