import { resolveCollectorLimits, type CollectorLimits } from "./batch-contract";

const JSON_CONTENT_TYPES = new Set(["application/json", "application/json; charset=utf-8"]);

export const isJsonContentType = (contentType: string | null): boolean => {
  if (!contentType) {
    return false;
  }
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return JSON_CONTENT_TYPES.has(normalized) || normalized === "application/json";
};

export const readBodyWithLimit = async (
  request: Request,
  limits: CollectorLimits | undefined,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "payload-too-large" }> => {
  const { maxBatchBytes } = resolveCollectorLimits(limits);
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBatchBytes) {
    return { ok: false, reason: "payload-too-large" };
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: true, bytes: new Uint8Array() };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBatchBytes) {
      await reader.cancel();
      return { ok: false, reason: "payload-too-large" };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: merged };
};

export const parsePublicKeyFromPath = (
  pathname: string,
  prefix = "/v1/collect/",
): string | undefined => {
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const key = pathname.slice(prefix.length).split("/")[0]?.trim();
  return key ? key : undefined;
};

export const normalizeOriginHost = (originOrReferer: string | null): string | undefined => {
  if (!originOrReferer) {
    return undefined;
  }
  try {
    const url = new URL(originOrReferer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
};

/**
 * When the browser sends an Origin header, only that origin is considered (no Referer fallback).
 * Without Origin, Referer may match for same-document navigations.
 */
export const isOriginAllowed = (request: Request, allowedOrigins: readonly string[]): boolean => {
  if (allowedOrigins.length === 0) {
    return true;
  }
  const originHeader = request.headers.get("origin");
  if (originHeader !== null) {
    const origin = normalizeOriginHost(originHeader);
    return origin !== undefined && allowedOrigins.includes(origin);
  }
  const refererOrigin = normalizeOriginHost(request.headers.get("referer"));
  return refererOrigin !== undefined && allowedOrigins.includes(refererOrigin);
};

export const corsHeadersForCollectResponse = (
  request: Request,
  allowedOrigins: readonly string[],
): Record<string, string> => {
  const headers: Record<string, string> = { vary: "Origin" };
  if (allowedOrigins.length === 0) {
    return headers;
  }
  const origin = normalizeOriginHost(request.headers.get("origin"));
  if (origin !== undefined && allowedOrigins.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
};

export const corsPreflightResponse = (
  request: Request,
  allowedOrigins: readonly string[],
): Response => {
  if (allowedOrigins.length === 0) {
    return new Response(null, {
      status: 204,
      headers: {
        vary: "Origin",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  const origin = normalizeOriginHost(request.headers.get("origin"));
  if (origin === undefined || !allowedOrigins.includes(origin)) {
    return new Response(null, { status: 403, headers: { vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      vary: "Origin",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
};
