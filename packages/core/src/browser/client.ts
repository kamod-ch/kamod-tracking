import {
  adoptExternalConsent,
  defaultCapturePolicy,
  mergeCapturePolicy,
  sessionRefFromId,
  type CaptureConfiguration,
  type CapturePolicyState,
  type ExternalConsentSnapshot,
} from "../core/capture-policy";
import {
  createMemoryConsentStore,
  recordConsent,
  readConsentState,
  UNSPECIFIED_LEGAL_BASIS,
} from "../core/consent";
import { resolveCaptureIdentity } from "../core/config";
import type { BusinessSubject, SessionRef } from "../core/envelope";
import { prepareContractEnvelope, type ContractIngestOptions } from "../core/contract-ingest";
import { createMemoryEnvelopeStore } from "../core/envelope-store";
import { createTrackingPipeline } from "../core/pipeline";
import type { EventRegistry } from "../core/registry";
import { cryptoIdFactory, systemClock, toIso } from "../core/runtime";
import { sanitizePath } from "../core/sanitize";
import { createMemoryEventStore } from "../core/store";
import type {
  ConsentStore,
  DeliveryResult,
  IdFactory,
  IngestResult,
  KeyValueStorage,
  Purpose,
  Tracker,
  TrackingEvent,
  Transport,
} from "../core/types";
import { createAbortRegistry } from "./abort-registry";
import { computeRetryDelayMs, isPermanentRejectReason } from "./backoff";
import { createCollectorTransport, type CollectorTransport } from "./collector-transport";
import { createDebugLogger } from "./debug-log";
import {
  createEventQueue,
  resolveQueueLimits,
  type QueueDiscardReason,
  type QueueLimits,
  type QueuedCollectorEvent,
} from "./event-queue";
import { clearBrowserSession, resolveBrowserSessionId } from "./session-store";
import { createUnloadHooks } from "./unload-hooks";
import { createViewImpressionState } from "./view-state";
import { createViewLifecycle, type ViewLifecycle } from "./view-lifecycle";

export type BrowserDiscardReason =
  | QueueDiscardReason
  | "validation-failed"
  | "server-rejected"
  | "offline";

export type BrowserTrackerOptions = {
  readonly appId: string;
  readonly tenantId?: string;
  readonly siteId?: string;
  readonly registry?: EventRegistry;
  readonly identityMode?: CapturePolicyState["identityMode"];
  /** @deprecated Use `identityMode`. */
  readonly visitorIdentity?: import("../core/config").VisitorIdentityMode;
  /** @deprecated Inject `collectorTransport` instead. */
  readonly transport?: Transport;
  readonly collectorTransport?: CollectorTransport;
  readonly sessionStorage?: KeyValueStorage;
  readonly storage?: KeyValueStorage;
  readonly consents?: ConsentStore;
  readonly ids?: IdFactory;
  readonly now?: () => Date;
  readonly endpoint?: string;
  readonly publicKey?: string;
  readonly maxRetries?: number;
  readonly initialCapture?: CaptureConfiguration;
  readonly queue?: QueueLimits;
  readonly debug?: boolean;
  readonly enableUnloadFlush?: boolean;
  readonly viewLifecycle?: ViewLifecycle;
};

export type BrowserCaptureInput = {
  readonly event_name: string;
  readonly schema_version: number;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly purpose?: Purpose;
  readonly occurred_at?: string;
  readonly subject?: BusinessSubject;
  readonly event_id?: string;
};

export type BrowserClient = Tracker & {
  capture(input: BrowserCaptureInput): Promise<IngestResult>;
  flush(options?: { readonly unload?: boolean }): Promise<{ readonly flushed: number }>;
  beginView(input: { readonly surface: string; readonly viewId?: string }): string;
  endView(): void;
  getViewLifecycle(): ViewLifecycle;
  destroy(): void;
  onDiscard(
    listener: (input: {
      readonly eventId: string;
      readonly reason: BrowserDiscardReason;
      readonly detail?: string;
    }) => void,
  ): () => void;
};

const STORAGE_PREFIX = "kamod-tracking";
export const DEFAULT_BROWSER_MAX_RETRIES = 3;

export const createBrowserTracker = (options: BrowserTrackerOptions): BrowserClient => {
  const consents = options.consents ?? createMemoryConsentStore();
  const identityMode = resolveCaptureIdentity(options);
  let capturePolicy: CapturePolicyState = mergeCapturePolicy(defaultCapturePolicy(), {
    identityMode,
    ...options.initialCapture,
  });
  const queueLimits = resolveQueueLimits(options.queue);
  const queue = createEventQueue(queueLimits);
  const pipeline = createTrackingPipeline({
    appId: options.appId,
    store: createMemoryEventStore(),
    consents,
    identityMode: capturePolicy.identityMode,
    clock: { now: options.now ?? systemClock.now },
    ids: options.ids ?? cryptoIdFactory,
  });
  const abortRegistry = createAbortRegistry();
  const ids = options.ids ?? cryptoIdFactory;
  const viewState = createViewImpressionState();
  const viewLifecycle = options.viewLifecycle ?? createViewLifecycle();
  const debug = createDebugLogger(options.debug === true);
  const unloadHooks = createUnloadHooks();
  const discardListeners = new Set<
    (input: { eventId: string; reason: BrowserDiscardReason; detail?: string }) => void
  >();

  let destroyed = false;
  let sendingStopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let flushChain: Promise<number> = Promise.resolve(0);
  const maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_BROWSER_MAX_RETRIES);

  const validationStore = createMemoryEnvelopeStore();
  const contractOptions = (): ContractIngestOptions | undefined => {
    if (!options.registry) {
      return undefined;
    }
    return {
      appId: options.appId,
      registry: options.registry,
      collector: {
        tenantId: options.tenantId ?? "tenant_default",
        siteId: options.siteId ?? "site_default",
        measurementRuleVersion: "mr_v1",
        collectionPolicyVersion: capturePolicy.identityMode,
        browserIdentityMode: capturePolicy.identityMode,
      },
      envelopeStore: validationStore,
      consents,
      clock: { now: options.now ?? systemClock.now },
      ids,
      allowSession: capturePolicy.identityMode === "session",
    };
  };

  const transport =
    options.collectorTransport ??
    (options.transport
      ? legacyTransportAdapter(options.transport)
      : options.endpoint
        ? createCollectorTransport({
            endpoint: options.endpoint,
            ...(options.publicKey !== undefined ? { publicKey: options.publicKey } : {}),
            ...(getBrowserRuntime()?.fetch ? { fetchImpl: getBrowserRuntime()!.fetch } : {}),
            ...(getBrowserRuntime()?.navigator?.sendBeacon
              ? { sendBeacon: getBrowserRuntime()!.navigator!.sendBeacon! }
              : {}),
            createAbortSignal: () => abortRegistry.createSignal(),
          })
        : undefined);

  const notifyDiscard = (eventId: string, reason: BrowserDiscardReason, detail?: string): void => {
    debug.log("discard", { eventId, reason, ...(detail ? { detail } : {}) });
    for (const listener of discardListeners) {
      try {
        listener({ eventId, reason, ...(detail !== undefined ? { detail } : {}) });
      } catch {
        // ignore host listener failures
      }
    }
  };

  queue.onDiscard(({ eventId, reason }) => notifyDiscard(eventId, reason));

  const sessionStorageKey = `${STORAGE_PREFIX}:${options.appId}:sid`;
  const legacyVisitorKey = `${STORAGE_PREFIX}:${options.appId}:vid`;

  const resolveSession = (purpose: Purpose) => {
    if (capturePolicy.identityMode !== "session") {
      return undefined;
    }
    if (readConsentState(consents, options.appId, purpose) !== "granted") {
      return undefined;
    }
    const storage = options.sessionStorage ?? options.storage ?? trySessionStorage();
    const nowMs = (options.now ?? systemClock.now)().getTime();
    const sessionId = resolveBrowserSessionId({
      storage,
      storageKey: sessionStorageKey,
      ids,
      nowMs,
      limits: capturePolicy.sessionLimits,
    });
    return sessionId !== undefined ? sessionRefFromId(sessionId) : undefined;
  };

  const scheduleRetry = (retryAfterSeconds?: number, attempt = 0): void => {
    if (destroyed || sendingStopped) {
      return;
    }
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
    }
    const delayMs = computeRetryDelayMs({
      attempt,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
    retryTimer = setTimeout(() => {
      void flushInternal();
    }, delayMs);
  };

  const runOneFlush = async (unload: boolean): Promise<number> => {
    if (destroyed || sendingStopped || !capturePolicy.networkSendingEnabled || !transport) {
      return 0;
    }
    let flushed = 0;
    try {
      const nowMs = (options.now ?? systemClock.now)().getTime();
      const batch = queue.takeBatch(queueLimits.maxBatchSize, nowMs);
      if (batch.length === 0) {
        return 0;
      }
      const result = await transport.sendBatch(batch, { unload });
      if (result.delivery === "verified" && result.outcomes) {
        const acceptedIds: string[] = [];
        const toRetry: QueuedCollectorEvent[] = [];
        for (const outcome of result.outcomes) {
          if (outcome.status === "accepted") {
            acceptedIds.push(outcome.event_id);
            flushed += 1;
            continue;
          }
          const queued = batch.find((entry) => entry.event_id === outcome.event_id);
          if (!queued) {
            continue;
          }
          if (isPermanentRejectReason(outcome.reason)) {
            notifyDiscard(outcome.event_id, "server-rejected", outcome.reason);
            continue;
          }
          if (queued.retryAttempt >= maxRetries) {
            notifyDiscard(outcome.event_id, "server-rejected", outcome.reason);
            continue;
          }
          toRetry.push({ ...queued, retryAttempt: queued.retryAttempt + 1 });
        }
        queue.removeByIds(acceptedIds);
        if (toRetry.length > 0) {
          queue.requeue(toRetry);
          scheduleRetry(result.retryAfterSeconds, toRetry[0]?.retryAttempt ?? 0);
        }
        return flushed;
      }

      if (result.delivery === "browser-accepted") {
        queue.removeByIds(batch.map((entry) => entry.event_id));
        debug.log("beacon-browser-accepted-not-verified", { count: batch.length });
        return batch.length;
      }

      if (result.retryable) {
        const retriable = batch
          .map((entry) => ({ ...entry, retryAttempt: entry.retryAttempt + 1 }))
          .filter((entry) => {
            if (entry.retryAttempt > maxRetries) {
              notifyDiscard(entry.event_id, "offline");
              return false;
            }
            return true;
          });
        queue.requeue(retriable);
        scheduleRetry(result.retryAfterSeconds, retriable[0]?.retryAttempt ?? 0);
      } else {
        for (const entry of batch) {
          notifyDiscard(entry.event_id, "server-rejected", "batch-failed");
        }
      }
      return 0;
    } finally {
      if (!destroyed && queue.size() > 0 && !sendingStopped) {
        void flushInternal(unload);
      }
    }
  };

  const flushInternal = (unload = false): Promise<number> => {
    const next = flushChain.then(() => runOneFlush(unload));
    flushChain = next.then(
      () => 0,
      () => 0,
    );
    return next;
  };

  const enqueueValidated = (event: QueuedCollectorEvent): IngestResult => {
    queue.enqueue(event);
    if (capturePolicy.networkSendingEnabled && !sendingStopped) {
      void flushInternal();
    }
    return {
      ok: true,
      event: {
        id: event.event_id,
        name: event.event_name,
        purpose: event.purpose,
        origin: "browser",
        trust: "untrusted",
        consent: readConsentState(consents, options.appId, event.purpose),
        legalBasis: UNSPECIFIED_LEGAL_BASIS,
        collectedAt: event.occurred_at,
        receivedAt: toIso((options.now ?? systemClock.now)()),
        timeBounds: {},
        appId: options.appId,
        subject: { type: "none" },
        properties: event.properties,
        ...(event.session !== undefined ? { session: event.session } : {}),
      },
      guarantee: "best-effort",
    };
  };

  const capture = async (input: BrowserCaptureInput): Promise<IngestResult> => {
    if (destroyed || sendingStopped) {
      return { ok: false, reason: "capture-disabled" };
    }
    const purpose = input.purpose ?? "analytics";
    const eventId = input.event_id ?? ids.eventId();
    const contract = contractOptions();
    if (!contract) {
      return { ok: false, reason: "invalid-payload" };
    }
    const session = resolveSession(purpose);
    const submitted = {
      id: eventId,
      appId: options.appId,
      name: input.event_name,
      schemaVersion: input.schema_version,
      origin: "browser" as const,
      purpose,
      collectedAt: input.occurred_at ?? toIso((options.now ?? systemClock.now)()),
      businessSubject: input.subject ?? { objectType: "none" as const },
      ...(session !== undefined ? { session } : {}),
      properties: input.properties,
    };
    const prepared = await prepareContractEnvelope(contract, submitted);
    if (!prepared.ok) {
      notifyDiscard(eventId, "validation-failed", prepared.reason);
      return prepared;
    }
    if (!prepared.envelope) {
      return { ok: false, reason: "invalid-payload" };
    }
    return enqueueValidated({
      event_id: prepared.envelope.event_id,
      appId: options.appId,
      schema_version: prepared.envelope.schema_version,
      event_name: prepared.envelope.event_name,
      occurred_at: prepared.envelope.occurred_at,
      subject: prepared.envelope.subject,
      properties: prepared.envelope.properties,
      purpose,
      enqueuedAtMs: (options.now ?? systemClock.now)().getTime(),
      retryAttempt: 0,
      ...(prepared.envelope.session !== undefined ? { session: prepared.envelope.session } : {}),
    });
  };

  const revokeSideEffects = (purpose: Purpose): void => {
    sendingStopped = true;
    queue.clear();
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    abortRegistry.abortAll();
    viewState.reset();
    viewLifecycle.reset();
    notifyDiscard("queue", "consent-revoked", purpose);
    const storage = options.sessionStorage ?? options.storage ?? trySessionStorage();
    clearBrowserSession(storage, sessionStorageKey);
    try {
      options.storage?.setItem(legacyVisitorKey, "");
    } catch {
      // ignore
    }
    recordConsent({
      store: consents,
      appId: options.appId,
      purpose,
      state: "denied",
      recordedAt: toIso((options.now ?? systemClock.now)()),
    });
  };

  if (options.enableUnloadFlush === true) {
    unloadHooks.install(() => {
      void flushInternal(true);
    });
  }

  const client: BrowserClient = {
    capture,
    async flush(flushOptions?: { readonly unload?: boolean }) {
      const flushed = await flushInternal(flushOptions?.unload === true);
      return { flushed };
    },
    beginView(input) {
      return viewLifecycle.beginView(input);
    },
    endView() {
      viewLifecycle.endView();
    },
    getViewLifecycle() {
      return viewLifecycle;
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      sendingStopped = true;
      queue.clear();
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      abortRegistry.abortAll();
      unloadHooks.remove();
      discardListeners.clear();
      viewLifecycle.reset();
      viewState.reset();
    },
    onDiscard(listener) {
      discardListeners.add(listener);
      return () => discardListeners.delete(listener);
    },
    async pageView(input) {
      const path = sanitizePath(input.path);
      if (capturePolicy.identityMode === "none" && !viewState.shouldRecordPageImpression(path)) {
        return { ok: false, reason: "duplicate-impression" };
      }
      if (options.registry) {
        return capture({
          event_name: "content.view",
          schema_version: 1,
          purpose: "analytics",
          properties: { path, content_type: "page", ...input.properties },
          ...(input.collectedAt !== undefined ? { occurred_at: input.collectedAt } : {}),
        });
      }
      return legacyPageView(path, input);
    },
    async track(input) {
      if (options.registry && input.name === "content.view") {
        return capture({
          event_name: input.name,
          schema_version: 1,
          purpose: input.purpose ?? "analytics",
          properties: (input.properties ?? {}) as Record<string, unknown>,
          ...(input.collectedAt !== undefined ? { occurred_at: input.collectedAt } : {}),
        });
      }
      return legacyTrack(input);
    },
    getConsent(purpose) {
      return readConsentState(consents, options.appId, purpose);
    },
    setConsent(purpose, state) {
      if (state === "denied") {
        revokeSideEffects(purpose);
        return;
      }
      sendingStopped = false;
      recordConsent({
        store: consents,
        appId: options.appId,
        purpose,
        state,
        recordedAt: toIso((options.now ?? systemClock.now)()),
      });
    },
    configureCapture(update) {
      capturePolicy = mergeCapturePolicy(capturePolicy, update);
      if (update.enableNetworkSending === true && !sendingStopped) {
        void flushInternal();
      }
    },
    adoptExternalConsent(snapshot: ExternalConsentSnapshot) {
      adoptExternalConsent({
        store: consents,
        appId: options.appId,
        snapshot,
        ...(options.now !== undefined ? { now: options.now } : {}),
      });
      if (snapshot.purposes.analytics === "denied") {
        revokeSideEffects("analytics");
      }
      if (snapshot.purposes.measurement === "denied") {
        revokeSideEffects("measurement");
      }
    },
    revokeCapture(purpose) {
      revokeSideEffects(purpose);
    },
    getCapturePolicy() {
      return capturePolicy;
    },
  };

  async function legacyPageView(
    path: string,
    input: { collectedAt?: string; properties?: Record<string, unknown> },
  ): Promise<IngestResult> {
    const purpose = "analytics" as const;
    const session = resolveSession(purpose);
    const submitted = {
      id: ids.eventId(),
      appId: options.appId,
      name: "page_view",
      origin: "browser" as const,
      purpose,
      collectedAt: input.collectedAt ?? toIso((options.now ?? systemClock.now)()),
      properties: { ...input.properties, path },
      ...(session !== undefined ? { session } : {}),
    };
    const result = await pipeline.ingest(submitted);
    if (result.ok && transport) {
      queue.enqueue(
        legacyToQueued(result.event, session, (options.now ?? systemClock.now)().getTime()),
      );
      if (capturePolicy.networkSendingEnabled) {
        await flushInternal();
      }
    }
    return result;
  }

  async function legacyTrack(input: {
    name: string;
    purpose?: Purpose;
    collectedAt?: string;
    properties?: Record<string, unknown>;
  }): Promise<IngestResult> {
    const purpose = input.purpose ?? "analytics";
    const session = resolveSession(purpose);
    const result = await pipeline.ingest({
      id: ids.eventId(),
      appId: options.appId,
      name: input.name,
      origin: "browser",
      purpose,
      ...(input.collectedAt !== undefined ? { collectedAt: input.collectedAt } : {}),
      ...(input.properties !== undefined ? { properties: input.properties } : {}),
      ...(session !== undefined ? { session } : {}),
    });
    if (result.ok && transport) {
      queue.enqueue(
        legacyToQueued(result.event, session, (options.now ?? systemClock.now)().getTime()),
      );
      if (capturePolicy.networkSendingEnabled) {
        await flushInternal();
      }
    }
    return result;
  }

  return client;
};

const legacyToQueued = (
  event: TrackingEvent,
  session: SessionRef | undefined,
  enqueuedAtMs: number,
): QueuedCollectorEvent => ({
  event_id: event.id,
  appId: event.appId,
  schema_version: 1,
  event_name: event.name,
  occurred_at: event.collectedAt,
  subject: { objectType: "none" },
  properties: event.properties,
  purpose: event.purpose,
  enqueuedAtMs,
  retryAttempt: 0,
  ...(session !== undefined
    ? { session }
    : event.session !== undefined
      ? { session: event.session }
      : {}),
});

const legacyTransportAdapter = (transport: Transport): CollectorTransport => ({
  async sendBatch(events) {
    const legacy = events.map(
      (event) =>
        ({
          id: event.event_id,
          appId: event.appId,
          name: event.event_name,
          purpose: event.purpose,
          collectedAt: event.occurred_at,
          properties: event.properties,
          origin: "browser",
          trust: "untrusted",
          consent: "granted",
          legalBasis: { kind: "unspecified" },
          receivedAt: event.occurred_at,
          timeBounds: {},
          subject: { type: "none" },
          ...(event.session !== undefined ? { session: event.session } : {}),
        }) as TrackingEvent,
    );
    const result = await transport.send(legacy);
    return {
      delivery: result.accepted > 0 ? "verified" : "failed",
      retryable: result.accepted === 0,
      outcomes: events.map((event) => ({
        event_id: event.event_id,
        status: "accepted" as const,
        duplicate: false,
      })),
    };
  },
});

export const withBestEffortRetries = (
  transport: Transport,
  maxAttempts = DEFAULT_BROWSER_MAX_RETRIES,
): Transport => {
  const attempts = Math.max(1, Math.min(maxAttempts, DEFAULT_BROWSER_MAX_RETRIES));
  return {
    async send(events): Promise<DeliveryResult> {
      const failed: DeliveryResult = {
        accepted: 0,
        dropped: events.length,
        guarantee: "best-effort",
      };
      const attempt = async (remaining: number): Promise<DeliveryResult> => {
        try {
          const result = await transport.send(events);
          if (result.accepted > 0 || remaining <= 1) {
            return result;
          }
        } catch {
          if (remaining <= 1) {
            return failed;
          }
        }
        return attempt(remaining - 1);
      };
      return attempt(attempts);
    },
  };
};

export const createMemoryTransport = (): Transport & { readonly sent: TrackingEvent[] } => {
  const sent: TrackingEvent[] = [];
  return {
    sent,
    async send(events): Promise<DeliveryResult> {
      sent.push(...events);
      return { accepted: events.length, dropped: 0, guarantee: "best-effort" };
    },
  };
};

export const createMemoryKeyValueStorage = (): KeyValueStorage => {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      const value = map.get(key);
      if (value === undefined || value === "") {
        return null;
      }
      return value;
    },
    setItem(key, value) {
      if (value === "") {
        map.delete(key);
        return;
      }
      map.set(key, value);
    },
  };
};

export const toBrowserIngestPayload = (event: TrackingEvent): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    id: event.id,
    appId: event.appId,
    name: event.name,
    purpose: event.purpose,
    collectedAt: event.collectedAt,
    properties: event.properties,
  };
  if (event.session !== undefined) {
    payload.session = event.session;
  }
  if (event.subject.type === "visitor") {
    payload.visitorId = event.subject.visitorId;
  }
  return payload;
};

type BrowserRuntime = {
  readonly sessionStorage?: KeyValueStorage;
  readonly localStorage?: KeyValueStorage;
  readonly fetch: typeof fetch;
  readonly navigator?: { sendBeacon?: (url: string, data?: string) => boolean };
};

const trySessionStorage = (): KeyValueStorage | undefined =>
  getBrowserRuntime()?.sessionStorage ?? getBrowserRuntime()?.localStorage;

const getBrowserRuntime = (): BrowserRuntime | undefined => {
  const global = globalThis as typeof globalThis & {
    sessionStorage?: KeyValueStorage;
    localStorage?: KeyValueStorage;
    navigator?: { sendBeacon?: (url: string, data?: string) => boolean };
    fetch?: typeof fetch;
  };
  if (typeof global.fetch !== "function") {
    return undefined;
  }
  return {
    fetch: global.fetch,
    ...(global.sessionStorage !== undefined ? { sessionStorage: global.sessionStorage } : {}),
    ...(global.localStorage !== undefined ? { localStorage: global.localStorage } : {}),
    ...(global.navigator !== undefined ? { navigator: global.navigator } : {}),
  };
};
