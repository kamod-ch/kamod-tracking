import type { AppendResult, EventStore, TrackingEvent } from "./types";

export const createMemoryEventStore = (): EventStore => {
  const events: TrackingEvent[] = [];
  const byId = new Map<string, TrackingEvent>();

  return {
    append(event): AppendResult {
      const existing = byId.get(event.id);
      if (existing) {
        return { duplicate: true };
      }
      byId.set(event.id, event);
      events.push(event);
      return { duplicate: false };
    },
    get(id) {
      return byId.get(id);
    },
    list() {
      return events;
    },
  };
};
