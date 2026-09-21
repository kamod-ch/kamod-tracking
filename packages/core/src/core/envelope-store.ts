import type { TrackingEventEnvelope } from "./envelope";
import type { AppendResult } from "./types";

export type EnvelopeStore = {
  append(event: TrackingEventEnvelope): AppendResult | Promise<AppendResult>;
  get(
    eventId: string,
  ): TrackingEventEnvelope | undefined | Promise<TrackingEventEnvelope | undefined>;
  list(): readonly TrackingEventEnvelope[] | Promise<readonly TrackingEventEnvelope[]>;
};

export const createMemoryEnvelopeStore = (): EnvelopeStore => {
  const events: TrackingEventEnvelope[] = [];
  const byId = new Map<string, TrackingEventEnvelope>();

  return {
    append(event): AppendResult {
      if (byId.has(event.event_id)) {
        return { duplicate: true };
      }
      byId.set(event.event_id, event);
      events.push(event);
      return { duplicate: false };
    },
    get(eventId) {
      return byId.get(eventId);
    },
    list() {
      return events;
    },
  };
};
