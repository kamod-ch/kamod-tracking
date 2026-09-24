export { createTrackingPipeline } from "./core/pipeline";
export type { TrackingPipeline, TrackingPipelineOptions } from "./core/pipeline";
export {
  DEFAULT_IDENTITY_MODE,
  DEFAULT_VISITOR_IDENTITY,
  resolveCaptureIdentity,
  resolveVisitorIdentity,
} from "./core/config";
export type { TrackingConfig, VisitorIdentityMode } from "./core/config";
export {
  DEFAULT_CAPTURE_IDENTITY_MODE,
  DEFAULT_SESSION_LIMITS,
  adoptExternalConsent,
  defaultCapturePolicy,
  mapLegacyVisitorIdentity,
  mergeCapturePolicy,
  resolveCaptureIdentityMode,
  sessionRefFromId,
  validateBrowserIdentityAgainstPolicy,
} from "./core/capture-policy";
export type {
  BrowserCollectionDecision,
  CaptureConfiguration,
  CaptureIdentityMode,
  CapturePolicyState,
  CollectorCollectionPolicy,
  ExternalConsentSnapshot,
  SessionLifetimeLimits,
} from "./core/capture-policy";
export { resolveEventCollectionPurpose } from "./core/collection-purpose";
export { createMemoryConsentStore, recordConsent, readConsentState } from "./core/consent";
export { createMemoryEventStore } from "./core/store";
export { createMemoryEnvelopeStore } from "./core/envelope-store";
export type { EnvelopeStore } from "./core/envelope-store";
export { sanitizePath, sanitizeProperties, sanitizeUrl, sanitizeForLog } from "./core/sanitize";
export { isAuditEvent } from "./core/audit-boundary";
export { cryptoIdFactory, systemClock } from "./core/runtime";
export { createEventRegistry, defineEvent } from "./core/registry";
export type {
  EventDefinition,
  EventRegistry,
  PropertiesFor,
  RegistryEventMap,
} from "./core/registry";
export {
  contentViewV1,
  contentViewV2,
  registerContentViewEvents,
} from "./core/events/content-view";
export type { ContentViewPropertiesV1, ContentViewPropertiesV2 } from "./core/events/content-view";
export { FORBIDDEN_PRODUCER_FIELDS } from "./core/envelope";
export { hasBusinessObjectId } from "./core/envelope";
export type {
  BusinessSubject,
  CollectorContext,
  EventProducerPayload,
  OccurredAtTrust,
  ProducerKind,
  PrivacyClass,
  SessionRef,
  TrackingEventEnvelope,
} from "./core/envelope";
export { serializeTrackingEvent, deserializeTrackingEvent } from "./core/serialize";
export type { SerializedTrackingEvent } from "./core/serialize";
export { hasForbiddenProducerFields, stripForbiddenProducerFields } from "./core/producer-guard";
export type {
  AppendResult,
  Clock,
  ConsentRecord,
  ConsentState,
  ConsentStore,
  CustomEventInput,
  DeliveryGuarantee,
  DeliveryResult,
  EventOrigin,
  EventStore,
  EventSubject,
  IdFactory,
  IngestRejectReason,
  IngestResult,
  JsonValue,
  KeyValueStorage,
  LegalBasis,
  PageViewInput,
  Purpose,
  ServerConversionInput,
  SubmittedEvent,
  TimeBounds,
  Tracker,
  TrackingEvent,
  Transport,
  TrustClass,
} from "./core/types";
