import type { TrackingEventEnvelope } from "../core/envelope";
import type { EnvelopeStore } from "../core/envelope-store";
import { hashEnvelopePayload, payloadHashesEqual } from "../postgres/payload-hash";
import type { BatchEnvelopeAcceptance, BatchEventOutcome } from "./batch-contract";

export const createResettableMemoryEnvelopeStore = (): EnvelopeStore & {
  reset(events: readonly TrackingEventEnvelope[]): void;
} => {
  let events: TrackingEventEnvelope[] = [];
  const byId = new Map<string, TrackingEventEnvelope>();
  return {
    append(event) {
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
    reset(next) {
      events = [...next];
      byId.clear();
      for (const event of events) {
        byId.set(event.event_id, event);
      }
    },
  };
};

export const createMemoryBatchEnvelopeAcceptance = (
  store: EnvelopeStore & { reset?: (events: readonly TrackingEventEnvelope[]) => void },
): BatchEnvelopeAcceptance => {
  return {
    async acceptBatch(envelopes) {
      const snapshot = structuredClone(await Promise.resolve(store.list()));
      const outcomes: BatchEventOutcome[] = [];
      const batchPayloadHashById = new Map<string, ReturnType<typeof hashEnvelopePayload>>();
      try {
        for (const envelope of envelopes) {
          const payloadHash = hashEnvelopePayload(envelope);
          const priorHash = batchPayloadHashById.get(envelope.event_id);
          if (priorHash !== undefined) {
            outcomes.push(
              payloadHashesEqual(priorHash, payloadHash)
                ? {
                    event_id: envelope.event_id,
                    status: "accepted",
                    duplicate: true,
                  }
                : {
                    event_id: envelope.event_id,
                    status: "rejected",
                    reason: "payload-conflict",
                  },
            );
            continue;
          }
          batchPayloadHashById.set(envelope.event_id, payloadHash);

          const existing = await Promise.resolve(store.get(envelope.event_id));
          if (existing) {
            const same = payloadHashesEqual(
              hashEnvelopePayload(existing),
              hashEnvelopePayload(envelope),
            );
            if (!same) {
              outcomes.push({
                event_id: envelope.event_id,
                status: "rejected",
                reason: "payload-conflict",
              });
              continue;
            }
            outcomes.push({
              event_id: envelope.event_id,
              status: "accepted",
              duplicate: true,
            });
            continue;
          }
          const appendResult = await Promise.resolve(store.append(envelope));
          if (appendResult.duplicate) {
            const stored = await Promise.resolve(store.get(envelope.event_id));
            const same =
              stored !== undefined &&
              payloadHashesEqual(hashEnvelopePayload(stored), hashEnvelopePayload(envelope));
            if (!same) {
              outcomes.push({
                event_id: envelope.event_id,
                status: "rejected",
                reason: "payload-conflict",
              });
              continue;
            }
          }
          outcomes.push({
            event_id: envelope.event_id,
            status: "accepted",
            duplicate: appendResult.duplicate,
          });
        }
        return { ok: true, outcomes };
      } catch {
        store.reset?.(snapshot);
        return { ok: false, retryable: true, reason: "storage-error" };
      }
    },
  };
};

export const createFailingBatchAcceptance = (): BatchEnvelopeAcceptance => ({
  async acceptBatch() {
    return { ok: false, retryable: true, reason: "storage-error" };
  },
});
