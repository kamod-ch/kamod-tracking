import type { Clock, IdFactory } from "./types";

export const systemClock: Clock = {
  now() {
    return new Date();
  },
};

export const cryptoIdFactory: IdFactory = {
  eventId() {
    return globalThis.crypto.randomUUID();
  },
  visitorId() {
    return globalThis.crypto.randomUUID();
  },
};

export const toIso = (date: Date): string => date.toISOString();
