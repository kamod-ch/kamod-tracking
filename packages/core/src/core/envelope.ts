import type { CaptureIdentityMode } from "./capture-policy";
import type { ConsentState, JsonValue, LegalBasis, Purpose, TrustClass } from "./types";

export type ProducerKind = "browser" | "server";

export type PrivacyClass = "public" | "internal" | "restricted";

export type BusinessSubject =
  | { readonly objectType: "none"; readonly objectId?: never }
  | { readonly objectType: Exclude<string, "none">; readonly objectId: string };

export const hasBusinessObjectId = (
  subject: BusinessSubject,
): subject is { readonly objectType: Exclude<string, "none">; readonly objectId: string } =>
  subject.objectType !== "none";

export type SessionRef = {
  readonly sessionId: string;
};

/** Fields a producer may send. Server-only fields are never read from the body. */
export type EventProducerPayload = {
  readonly event_id: string;
  readonly schema_version: number;
  readonly event_name: string;
  readonly occurred_at: string;
  readonly subject: BusinessSubject;
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly session?: SessionRef;
};

export type OccurredAtTrust = "producer" | "adjusted";

/** Stored envelope after server-side enrichment. */
export type TrackingEventEnvelope = EventProducerPayload & {
  readonly tenant_id: string;
  readonly site_id: string;
  readonly received_at: string;
  readonly producer: ProducerKind;
  readonly trust_class: TrustClass;
  readonly measurement_rule_version: string;
  readonly collection_policy_version: string;
  readonly purpose: Purpose;
  readonly consent: ConsentState;
  readonly legalBasis: LegalBasis;
  readonly occurred_at_trust: OccurredAtTrust;
};

export type CollectorContext = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly measurementRuleVersion: string;
  readonly collectionPolicyVersion: string;
  /**
   * Identity modes the collector accepts from browser producers.
   * Browser-reported consent does not override this list.
   */
  readonly allowedBrowserIdentityModes?: readonly CaptureIdentityMode[];
  /** Active identity mode for this site (server configuration). */
  readonly browserIdentityMode?: CaptureIdentityMode;
};

/** Producer bodies must not carry authoritative server fields. */
export const FORBIDDEN_PRODUCER_FIELDS = [
  "tenant_id",
  "site_id",
  "received_at",
  "producer",
  "trust_class",
  "measurement_rule_version",
  "collection_policy_version",
] as const;

export type ForbiddenProducerField = (typeof FORBIDDEN_PRODUCER_FIELDS)[number];
