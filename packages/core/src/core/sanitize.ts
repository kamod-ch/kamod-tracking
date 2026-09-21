import type { JsonValue } from "./types";

const BLOCKED_KEY_PATTERN =
  /^(email|e-mail|password|passwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|auth|cookie|set-cookie|ssn|social[_-]?security|phone|tel|address|street|name|firstname|lastname|full[_-]?name|username|user[_-]?name|form|message|comment|body|query)$/i;

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_PATTERN = /^bearer\s+/i;

export type SanitizeResult =
  | { readonly ok: true; readonly properties: Record<string, JsonValue> }
  | { readonly ok: false; readonly reason: "pii-rejected" | "invalid-payload" };

export const sanitizePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return "/";
  }
  const withoutQuery = trimmed.split("?")[0] ?? "/";
  const withoutHash = withoutQuery.split("#")[0] ?? "/";
  return withoutHash || "/";
};

/**
 * Keep origin + pathname. Drop search, hash, credentials, and userinfo.
 * Full sensitive URLs must not enter analytics or logs.
 */
export const sanitizeUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      return undefined;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    if (value.startsWith("/")) {
      return sanitizePath(value);
    }
    return undefined;
  }
};

export const looksLikeSensitiveString = (value: string): boolean => {
  const trimmed = value.trim();
  return EMAIL_PATTERN.test(trimmed) || JWT_PATTERN.test(trimmed) || BEARER_PATTERN.test(trimmed);
};

export const isBlockedKey = (key: string): boolean => BLOCKED_KEY_PATTERN.test(key);

export const sanitizeProperties = (input: unknown, depth = 0): SanitizeResult => {
  if (input === undefined) {
    return { ok: true, properties: {} };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "invalid-payload" };
  }
  if (depth > 4) {
    return { ok: false, reason: "invalid-payload" };
  }

  const properties: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isBlockedKey(key)) {
      return { ok: false, reason: "pii-rejected" };
    }
    const sanitized = sanitizeValue(key, value, depth);
    if (!sanitized.ok) {
      return sanitized;
    }
    if (sanitized.value !== undefined) {
      properties[key] = sanitized.value;
    }
  }
  return { ok: true, properties };
};

type ValueResult =
  | { readonly ok: true; readonly value?: JsonValue }
  | { readonly ok: false; readonly reason: "pii-rejected" | "invalid-payload" };

const sanitizeValue = (key: string, value: unknown, depth: number): ValueResult => {
  if (value === undefined) {
    return { ok: true };
  }
  if (value === null || typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: "invalid-payload" };
  }
  if (typeof value === "string") {
    if (looksLikeSensitiveString(value)) {
      return { ok: false, reason: "pii-rejected" };
    }
    if (key === "url" || key === "href" || key.endsWith("Url") || key.endsWith("Href")) {
      const url = sanitizeUrl(value);
      return url === undefined ? { ok: false, reason: "pii-rejected" } : { ok: true, value: url };
    }
    if (key === "path" || key === "pathname") {
      return { ok: true, value: sanitizePath(value) };
    }
    if (value.length > 256) {
      return { ok: false, reason: "invalid-payload" };
    }
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    if (value.length > 32) {
      return { ok: false, reason: "invalid-payload" };
    }
    const items: JsonValue[] = [];
    for (const item of value) {
      const sanitized = sanitizeValue(key, item, depth + 1);
      if (!sanitized.ok) return sanitized;
      if (sanitized.value !== undefined) items.push(sanitized.value);
    }
    return { ok: true, value: items };
  }
  if (typeof value === "object") {
    const nested = sanitizeProperties(value, depth + 1);
    if (!nested.ok) return nested;
    return { ok: true, value: nested.properties };
  }
  return { ok: false, reason: "invalid-payload" };
};

export const sanitizeForLog = (value: unknown): JsonValue => {
  const result = sanitizeProperties(asObject(value));
  return result.ok ? result.properties : { redacted: true };
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value: String(value) };
};
