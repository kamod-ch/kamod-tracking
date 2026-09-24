import { createHash } from "node:crypto";
import type { TrackingEventEnvelope } from "../core/envelope";
import { dedupContentFromEnvelope, stableStringify } from "../core/envelope-dedup";

export type { DedupEnvelopeContent } from "../core/envelope-dedup";
export {
  dedupContentFromEnvelope,
  envelopesHaveSameDedupContent,
  stableStringify,
} from "../core/envelope-dedup";

export const hashEnvelopePayload = (envelope: TrackingEventEnvelope): Buffer => {
  const canonical = stableStringify(dedupContentFromEnvelope(envelope));
  return createHash("sha256").update(canonical, "utf8").digest();
};

export const payloadHashesEqual = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && left.equals(right);
