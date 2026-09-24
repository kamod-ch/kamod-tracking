export const computeRetryDelayMs = (input: {
  readonly attempt: number;
  readonly retryAfterSeconds?: number;
  readonly random?: () => number;
}): number => {
  if (input.retryAfterSeconds !== undefined && input.retryAfterSeconds > 0) {
    return input.retryAfterSeconds * 1000;
  }
  const random = input.random ?? Math.random;
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, input.attempt));
  const jitter = random() * 0.25 * base;
  return Math.round(base + jitter);
};

export const PERMANENT_SERVER_REJECT_REASONS = new Set([
  "invalid-payload",
  "pii-rejected",
  "forbidden-producer-field",
  "unknown-event",
  "unknown-version",
  "version-retired",
  "producer-not-allowed",
  "identity-not-allowed",
  "consent-denied",
  "audit-event",
  "identity-link-forbidden",
  "trust-mismatch",
  "unknown-app",
  "payload-too-large",
  "payload-conflict",
]);

export const isPermanentRejectReason = (reason: string): boolean =>
  PERMANENT_SERVER_REJECT_REASONS.has(reason);
