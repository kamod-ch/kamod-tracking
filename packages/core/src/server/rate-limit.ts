/**
 * Process-local rate limiting. Not safe for multi-instance clusters without external store.
 */
export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export type RateLimiter = {
  check(key: string, nowMs?: number): RateLimitDecision;
};

export type MemoryRateLimiterOptions = {
  readonly maxRequests: number;
  readonly windowMs: number;
};

export const createMemoryRateLimiter = (options: MemoryRateLimiterOptions): RateLimiter => {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key, nowMs = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || nowMs >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: nowMs + options.windowMs });
        return { allowed: true };
      }
      if (bucket.count >= options.maxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
      bucket.count += 1;
      return { allowed: true };
    },
  };
};
