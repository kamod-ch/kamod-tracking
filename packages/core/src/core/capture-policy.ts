import { recordConsent } from "./consent";
import type { ConsentStore } from "./types";
import type { VisitorIdentityMode } from "./config";
import { toIso } from "./runtime";
import type { ConsentState, Purpose, SubmittedEvent } from "./types";

/**
 * How the browser may attach continuity identifiers to events.
 * `authenticated` is enforced on trusted server events; the browser must not emit raw auth ids.
 */
export type CaptureIdentityMode = "none" | "session" | "authenticated";

export const DEFAULT_CAPTURE_IDENTITY_MODE: CaptureIdentityMode = "none";

export type SessionLifetimeLimits = {
  /** Close the session after this much inactivity (default 30 minutes). */
  readonly inactivityMs?: number;
  /** Hard cap on session age (default 24 hours). */
  readonly maxAgeMs?: number;
};

export const DEFAULT_SESSION_LIMITS: Required<SessionLifetimeLimits> = {
  inactivityMs: 30 * 60_000,
  maxAgeMs: 24 * 60 * 60_000,
};

export type CapturePolicyState = {
  readonly identityMode: CaptureIdentityMode;
  /** When false, events may be ingested locally but must not be sent over the network. */
  readonly networkSendingEnabled: boolean;
  readonly sessionLimits: Required<SessionLifetimeLimits>;
};

export type CaptureConfiguration = {
  readonly identityMode?: CaptureIdentityMode;
  readonly enableNetworkSending?: boolean;
  readonly sessionLimits?: SessionLifetimeLimits;
};

/**
 * Snapshot from an existing consent / privacy manager.
 * Browser-reported consent is collection permission only — not a verified legal consent record.
 */
export type ExternalConsentSnapshot = {
  readonly recordedAt?: string;
  readonly purposes: Partial<Record<Purpose, Exclude<ConsentState, "unknown">>>;
};

export const mapLegacyVisitorIdentity = (
  legacy: VisitorIdentityMode | undefined,
): CaptureIdentityMode | undefined => {
  if (legacy === "off") return "none";
  if (legacy === "app-scoped") return "session";
  return undefined;
};

export const resolveCaptureIdentityMode = (input: {
  readonly identityMode?: CaptureIdentityMode;
  readonly visitorIdentity?: VisitorIdentityMode;
}): CaptureIdentityMode =>
  input.identityMode ??
  mapLegacyVisitorIdentity(input.visitorIdentity) ??
  DEFAULT_CAPTURE_IDENTITY_MODE;

export const defaultCapturePolicy = (): CapturePolicyState => ({
  identityMode: DEFAULT_CAPTURE_IDENTITY_MODE,
  networkSendingEnabled: false,
  sessionLimits: { ...DEFAULT_SESSION_LIMITS },
});

export const mergeCapturePolicy = (
  current: CapturePolicyState,
  update: CaptureConfiguration,
): CapturePolicyState => ({
  identityMode: update.identityMode ?? current.identityMode,
  networkSendingEnabled: update.enableNetworkSending ?? current.networkSendingEnabled,
  sessionLimits: {
    inactivityMs: update.sessionLimits?.inactivityMs ?? current.sessionLimits.inactivityMs,
    maxAgeMs: update.sessionLimits?.maxAgeMs ?? current.sessionLimits.maxAgeMs,
  },
});

export const adoptExternalConsent = (input: {
  readonly store: ConsentStore;
  readonly appId: string;
  readonly snapshot: ExternalConsentSnapshot;
  readonly now?: () => Date;
}): void => {
  const recordedAt = input.snapshot.recordedAt ?? toIso((input.now ?? (() => new Date()))());
  for (const purpose of ["necessary", "analytics", "measurement"] as const) {
    const state = input.snapshot.purposes[purpose];
    if (state !== undefined) {
      recordConsent({
        store: input.store,
        appId: input.appId,
        purpose,
        state,
        recordedAt,
      });
    }
  }
};

/**
 * Collector-side guard: allowed modes are configured independently of browser-reported consent.
 */
export const validateBrowserIdentityAgainstPolicy = (input: {
  readonly allowedModes: readonly CaptureIdentityMode[];
  readonly configuredMode: CaptureIdentityMode;
  readonly submitted: SubmittedEvent;
}): "identity-not-allowed" | null => {
  if (input.submitted.origin !== "browser") {
    return null;
  }
  if (!input.allowedModes.includes(input.configuredMode)) {
    return "identity-not-allowed";
  }
  if (input.configuredMode === "none") {
    if (input.submitted.visitorId !== undefined || input.submitted.session !== undefined) {
      return "identity-not-allowed";
    }
  }
  if (input.configuredMode === "session") {
    if (input.submitted.visitorId !== undefined) {
      return "identity-not-allowed";
    }
  }
  if (input.configuredMode === "authenticated") {
    if (
      input.submitted.visitorId !== undefined ||
      input.submitted.session !== undefined ||
      input.submitted.accountId !== undefined
    ) {
      return "identity-not-allowed";
    }
  }
  return null;
};

export const sessionRefFromId = (sessionId: string): { readonly sessionId: string } => ({
  sessionId,
});
