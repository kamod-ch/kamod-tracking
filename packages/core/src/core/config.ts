import {
  DEFAULT_CAPTURE_IDENTITY_MODE,
  resolveCaptureIdentityMode,
  type CaptureIdentityMode,
} from "./capture-policy";

/** @deprecated Use `CaptureIdentityMode` (`none` | `session` | `authenticated`). */
export type VisitorIdentityMode = "off" | "app-scoped";

/**
 * Framework-independent tracking configuration.
 * Default identity mode is `none` (no visitor or session continuity in payloads).
 */
export type TrackingConfig = {
  readonly appId: string;
  readonly identityMode?: CaptureIdentityMode;
  /** @deprecated Use `identityMode`. `off` → `none`, `app-scoped` → `session`. */
  readonly visitorIdentity?: VisitorIdentityMode;
};

export const DEFAULT_VISITOR_IDENTITY: VisitorIdentityMode = "off";

export const resolveCaptureIdentity = (
  config:
    | TrackingConfig
    | {
        readonly identityMode?: CaptureIdentityMode;
        readonly visitorIdentity?: VisitorIdentityMode;
      },
): CaptureIdentityMode => resolveCaptureIdentityMode(config);

/** @deprecated Use `resolveCaptureIdentity`. */
export const resolveVisitorIdentity = (
  config: TrackingConfig | { readonly visitorIdentity?: VisitorIdentityMode },
): VisitorIdentityMode => {
  const mode = resolveCaptureIdentityMode(config);
  if (mode === "session") return "app-scoped";
  return "off";
};

export { DEFAULT_CAPTURE_IDENTITY_MODE as DEFAULT_IDENTITY_MODE };
