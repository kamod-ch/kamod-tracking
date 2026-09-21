/**
 * Client address for ephemeral rate limiting only. Never persisted to analytics.
 */
export type TrustedProxyOptions = {
  readonly trustedHopIps?: readonly string[];
};

export const clientIpForRateLimit = (
  request: Request,
  options: TrustedProxyOptions = {},
): string | undefined => {
  const remote = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && options.trustedHopIps && options.trustedHopIps.length > 0) {
    const hops = forwarded.split(",").map((part) => part.trim());
    const client = hops[0];
    const peer = request.headers.get("x-trusted-proxy-peer");
    if (client && peer && options.trustedHopIps.includes(peer)) {
      return client;
    }
    return undefined;
  }
  return remote ?? undefined;
};
