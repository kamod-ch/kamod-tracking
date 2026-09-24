import type { BusinessSubject, SessionRef } from "../core/envelope";
import type { JsonValue, Purpose } from "../core/types";

export type QueuedCollectorEvent = {
  readonly event_id: string;
  readonly appId: string;
  readonly schema_version: number;
  readonly event_name: string;
  readonly occurred_at: string;
  readonly subject: BusinessSubject;
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly purpose: Purpose;
  readonly enqueuedAtMs: number;
  readonly retryAttempt: number;
  readonly session?: SessionRef;
};

export type QueueDiscardReason = "queue-full" | "event-expired" | "consent-revoked" | "destroyed";

export type QueueLimits = {
  readonly maxEvents?: number;
  readonly maxBatchSize?: number;
  readonly maxEventAgeMs?: number;
};

export const DEFAULT_QUEUE_LIMITS: Required<QueueLimits> = {
  maxEvents: 256,
  maxBatchSize: 10,
  maxEventAgeMs: 24 * 60 * 60_000,
};

export type EventQueue = {
  enqueue(event: QueuedCollectorEvent): boolean;
  takeBatch(maxSize: number, nowMs: number): QueuedCollectorEvent[];
  requeue(events: readonly QueuedCollectorEvent[]): void;
  removeByIds(ids: readonly string[]): void;
  removeByPurpose(purpose: Purpose): void;
  clear(): void;
  size(): number;
  onDiscard(listener: (input: { eventId: string; reason: QueueDiscardReason }) => void): () => void;
};

export const createEventQueue = (limits: QueueLimits = {}): EventQueue => {
  const resolved: Required<QueueLimits> = {
    maxEvents: limits.maxEvents ?? DEFAULT_QUEUE_LIMITS.maxEvents,
    maxBatchSize: limits.maxBatchSize ?? DEFAULT_QUEUE_LIMITS.maxBatchSize,
    maxEventAgeMs: limits.maxEventAgeMs ?? DEFAULT_QUEUE_LIMITS.maxEventAgeMs,
  };
  const items: QueuedCollectorEvent[] = [];
  const listeners = new Set<(input: { eventId: string; reason: QueueDiscardReason }) => void>();

  const notify = (eventId: string, reason: QueueDiscardReason): void => {
    for (const listener of listeners) {
      try {
        listener({ eventId, reason });
      } catch {
        // SDK errors must not break the host app.
      }
    }
  };

  return {
    enqueue(event) {
      if (items.length >= resolved.maxEvents) {
        const dropped = items.shift();
        if (dropped) {
          notify(dropped.event_id, "queue-full");
        }
      }
      items.push(event);
      return true;
    },
    takeBatch(maxSize, nowMs) {
      const batch: QueuedCollectorEvent[] = [];
      const remaining: QueuedCollectorEvent[] = [];
      for (const item of items) {
        if (nowMs - item.enqueuedAtMs > resolved.maxEventAgeMs) {
          notify(item.event_id, "event-expired");
          continue;
        }
        if (batch.length < maxSize) {
          batch.push(item);
        } else {
          remaining.push(item);
        }
      }
      items.length = 0;
      items.push(...remaining);
      return batch;
    },
    requeue(events) {
      for (const event of events) {
        this.enqueue(event);
      }
    },
    removeByIds(ids) {
      const drop = new Set(ids);
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item && drop.has(item.event_id)) {
          items.splice(i, 1);
        }
      }
    },
    removeByPurpose(purpose) {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item && item.purpose === purpose) {
          notify(item.event_id, "consent-revoked");
          items.splice(i, 1);
        }
      }
    },
    clear() {
      items.length = 0;
    },
    size() {
      return items.length;
    },
    onDiscard(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const resolveQueueLimits = (limits: QueueLimits | undefined): Required<QueueLimits> => ({
  maxEvents: limits?.maxEvents ?? DEFAULT_QUEUE_LIMITS.maxEvents,
  maxBatchSize: limits?.maxBatchSize ?? DEFAULT_QUEUE_LIMITS.maxBatchSize,
  maxEventAgeMs: limits?.maxEventAgeMs ?? DEFAULT_QUEUE_LIMITS.maxEventAgeMs,
});
