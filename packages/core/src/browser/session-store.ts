import type { SessionLifetimeLimits } from "../core/capture-policy";
import { DEFAULT_SESSION_LIMITS } from "../core/capture-policy";
import type { IdFactory, KeyValueStorage } from "../core/types";

export type SessionRecord = {
  readonly sessionId: string;
  readonly createdAtMs: number;
  readonly lastActivityAtMs: number;
};

const encode = (record: SessionRecord): string => JSON.stringify(record);

const decode = (raw: string): SessionRecord | undefined => {
  try {
    const parsed = JSON.parse(raw) as SessionRecord;
    if (
      typeof parsed.sessionId === "string" &&
      typeof parsed.createdAtMs === "number" &&
      typeof parsed.lastActivityAtMs === "number"
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export const isSessionExpired = (
  record: SessionRecord,
  nowMs: number,
  limits: Required<SessionLifetimeLimits> = DEFAULT_SESSION_LIMITS,
): boolean => {
  if (nowMs - record.createdAtMs > limits.maxAgeMs) {
    return true;
  }
  if (nowMs - record.lastActivityAtMs > limits.inactivityMs) {
    return true;
  }
  return false;
};

export const resolveBrowserSessionId = (input: {
  readonly storage: KeyValueStorage | undefined;
  readonly storageKey: string;
  readonly ids: IdFactory;
  readonly nowMs: number;
  readonly limits?: SessionLifetimeLimits;
}): string | undefined => {
  const limits: Required<SessionLifetimeLimits> = {
    inactivityMs: input.limits?.inactivityMs ?? DEFAULT_SESSION_LIMITS.inactivityMs,
    maxAgeMs: input.limits?.maxAgeMs ?? DEFAULT_SESSION_LIMITS.maxAgeMs,
  };
  if (!input.storage) {
    return input.ids.visitorId();
  }
  try {
    const existingRaw = input.storage.getItem(input.storageKey);
    if (existingRaw) {
      const existing = decode(existingRaw);
      if (existing && !isSessionExpired(existing, input.nowMs, limits)) {
        const updated: SessionRecord = {
          ...existing,
          lastActivityAtMs: input.nowMs,
        };
        input.storage.setItem(input.storageKey, encode(updated));
        return updated.sessionId;
      }
    }
    const created: SessionRecord = {
      sessionId: input.ids.visitorId(),
      createdAtMs: input.nowMs,
      lastActivityAtMs: input.nowMs,
    };
    input.storage.setItem(input.storageKey, encode(created));
    return created.sessionId;
  } catch {
    return input.ids.visitorId();
  }
};

export const clearBrowserSession = (
  storage: KeyValueStorage | undefined,
  storageKey: string,
): void => {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey, "");
  } catch {
    // Storage failures are ignored; session continuity is best-effort only.
  }
};
