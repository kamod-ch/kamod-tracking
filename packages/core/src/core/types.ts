/** Where a measurement was produced. Never inferred from payload shape. */
export type EventOrigin = "browser" | "server";

/**
 * Browser submissions are always untrusted.
 * Business successes are trusted only when recorded on the server.
 */
export type TrustClass = "untrusted" | "trusted";

/**
 * Collection permission recorded from a consent UI.
 * This is not a legal basis and is never promoted into one.
 */
export type ConsentState = "unknown" | "granted" | "denied";

/**
 * Legal basis is supplied by the application.
 * This library does not decide, infer, or validate whether a basis is lawful.
 */
export type LegalBasis =
  | { readonly kind: "unspecified" }
  | { readonly kind: "declared"; readonly code: string };

export type Purpose = "necessary" | "analytics" | "measurement";

/** Delivery is best-effort. The library does not promise exactly-once browser delivery. */
export type DeliveryGuarantee = "best-effort";

export type TimeBounds = {
  readonly windowStart?: string;
  readonly windowEnd?: string;
};

export type EventSubject =
  | { readonly type: "none" }
  | { readonly type: "visitor"; readonly visitorId: string }
  | { readonly type: "account"; readonly accountId: string };

export type TrackingEvent = {
  readonly id: string;
  readonly name: string;
  readonly purpose: Purpose;
  readonly origin: EventOrigin;
  readonly trust: TrustClass;
  readonly consent: ConsentState;
  readonly legalBasis: LegalBasis;
  readonly collectedAt: string;
  readonly receivedAt: string;
  readonly timeBounds: TimeBounds;
  readonly appId: string;
  readonly subject: EventSubject;
  readonly session?: import("./envelope").SessionRef;
  readonly properties: Readonly<Record<string, JsonValue>>;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type IngestRejectReason =
  | "audit-event"
  | "consent-denied"
  | "invalid-payload"
  | "pii-rejected"
  | "identity-link-forbidden"
  | "trust-mismatch"
  | "unknown-app"
  | "unknown-event"
  | "unknown-version"
  | "version-retired"
  | "producer-not-allowed"
  | "payload-too-large"
  | "forbidden-producer-field"
  | "duplicate-impression"
  | "capture-disabled"
  | "identity-not-allowed";

export type IngestResult =
  | {
      readonly ok: true;
      readonly event: TrackingEvent;
      readonly envelope?: import("./envelope").TrackingEventEnvelope;
      readonly guarantee: DeliveryGuarantee;
    }
  | { readonly ok: false; readonly reason: IngestRejectReason };

export type Clock = {
  now(): Date;
};

export type IdFactory = {
  eventId(): string;
  visitorId(): string;
};

export type ConsentRecord = {
  readonly purpose: Purpose;
  readonly state: ConsentState;
  readonly recordedAt: string;
  readonly legalBasis: LegalBasis;
};

export type ConsentStore = {
  get(appId: string, purpose: Purpose): ConsentRecord | undefined;
  set(appId: string, record: ConsentRecord): void;
};

export type AppendResult = {
  readonly duplicate: boolean;
};

export type EventStore = {
  /** First write for an event id wins. Retries with the same id are accepted as duplicates. */
  append(event: TrackingEvent): AppendResult | Promise<AppendResult>;
  get(id: string): TrackingEvent | undefined;
  list(): readonly TrackingEvent[];
};

export type PageViewInput = {
  readonly appId: string;
  readonly path: string;
  readonly collectedAt?: string;
  readonly timeBounds?: TimeBounds;
  readonly legalBasis?: LegalBasis;
  readonly properties?: Readonly<Record<string, unknown>>;
};

export type CustomEventInput = {
  readonly appId: string;
  readonly name: string;
  readonly purpose?: Purpose;
  readonly collectedAt?: string;
  readonly timeBounds?: TimeBounds;
  readonly legalBasis?: LegalBasis;
  readonly properties?: Readonly<Record<string, unknown>>;
};

export type ServerConversionInput = {
  readonly appId: string;
  readonly name: string;
  readonly collectedAt?: string;
  readonly timeBounds?: TimeBounds;
  readonly legalBasis?: LegalBasis;
  readonly accountId?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
};

export type SubmittedEvent = {
  readonly id?: string;
  readonly appId: string;
  readonly name: string;
  readonly schemaVersion?: number;
  readonly purpose?: Purpose;
  readonly origin: EventOrigin;
  readonly collectedAt?: string;
  readonly timeBounds?: TimeBounds;
  readonly legalBasis?: LegalBasis;
  readonly visitorId?: string;
  readonly accountId?: string;
  readonly session?: import("./envelope").SessionRef;
  readonly businessSubject?: import("./envelope").BusinessSubject;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly channel?: string;
  readonly kind?: string;
  readonly rawProducerRecord?: Readonly<Record<string, unknown>>;
};

export type Tracker = {
  pageView(
    input: Omit<PageViewInput, "appId"> & { readonly appId?: string },
  ): Promise<IngestResult>;
  track(
    input: Omit<CustomEventInput, "appId"> & { readonly appId?: string },
  ): Promise<IngestResult>;
  getConsent(purpose: Purpose): ConsentState;
  /**
   * Records collection permission. Does not set or infer a legal basis.
   */
  setConsent(purpose: Purpose, state: Exclude<ConsentState, "unknown">): void;
  configureCapture(input: import("./capture-policy").CaptureConfiguration): void;
  adoptExternalConsent(input: import("./capture-policy").ExternalConsentSnapshot): void;
  revokeCapture(purpose: Purpose): void;
  getCapturePolicy(): Readonly<import("./capture-policy").CapturePolicyState>;
};

export type DeliveryResult = {
  readonly accepted: number;
  readonly dropped: number;
  readonly guarantee: DeliveryGuarantee;
};

export type Transport = {
  send(events: readonly TrackingEvent[]): Promise<DeliveryResult>;
};

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
