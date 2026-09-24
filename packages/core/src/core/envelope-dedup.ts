import type { TrackingEventEnvelope } from "./envelope";
import type { JsonValue } from "./types";

/** Fields that define event content for dedup (excludes `event_id` and `received_at`). */
export type DedupEnvelopeContent = {
  readonly schema_version: number;
  readonly event_name: string;
  readonly occurred_at: string;
  readonly subject: TrackingEventEnvelope["subject"];
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly session?: TrackingEventEnvelope["session"];
  readonly tenant_id: string;
  readonly site_id: string;
  readonly producer: TrackingEventEnvelope["producer"];
  readonly trust_class: TrackingEventEnvelope["trust_class"];
  readonly measurement_rule_version: string;
  readonly collection_policy_version: string;
  readonly purpose: TrackingEventEnvelope["purpose"];
  readonly consent: TrackingEventEnvelope["consent"];
  readonly legalBasis: TrackingEventEnvelope["legalBasis"];
  readonly occurred_at_trust: TrackingEventEnvelope["occurred_at_trust"];
};

export const dedupContentFromEnvelope = (
  envelope: TrackingEventEnvelope,
): DedupEnvelopeContent => ({
  schema_version: envelope.schema_version,
  event_name: envelope.event_name,
  occurred_at: envelope.occurred_at,
  subject: envelope.subject,
  properties: envelope.properties,
  tenant_id: envelope.tenant_id,
  site_id: envelope.site_id,
  producer: envelope.producer,
  trust_class: envelope.trust_class,
  measurement_rule_version: envelope.measurement_rule_version,
  collection_policy_version: envelope.collection_policy_version,
  purpose: envelope.purpose,
  consent: envelope.consent,
  legalBasis: envelope.legalBasis,
  occurred_at_trust: envelope.occurred_at_trust,
  ...(envelope.session !== undefined ? { session: envelope.session } : {}),
});

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  keys.sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

export const envelopesHaveSameDedupContent = (
  left: TrackingEventEnvelope,
  right: TrackingEventEnvelope,
): boolean =>
  stableStringify(dedupContentFromEnvelope(left)) ===
  stableStringify(dedupContentFromEnvelope(right));
