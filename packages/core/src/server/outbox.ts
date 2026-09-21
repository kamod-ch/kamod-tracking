import { createHash } from "node:crypto";
import type { BusinessSubject } from "../core/envelope";
import type { JsonValue } from "../core/types";

/**
 * Transaction outbox handoff. The SDK does not run business transactions.
 */
export type OutboxTrackingRecord = {
  readonly outboxId: string;
  readonly eventName: string;
  readonly schemaVersion: number;
  readonly occurredAt: string;
  readonly subject: BusinessSubject;
  readonly properties: Readonly<Record<string, JsonValue>>;
  /** Pseudonymous internal account reference from auth context — never from browser payloads. */
  readonly pseudonymousAccountRef?: string;
};

export const eventIdFromOutboxId = (outboxId: string): string => {
  const digest = createHash("sha256").update(`outbox:${outboxId}`, "utf8").digest("hex");
  return `obx_${digest.slice(0, 40)}`;
};

export type OutboxWriteResult =
  | { readonly ok: true; readonly eventId: string; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: "invalid-payload" | "storage-error" };

export type OutboxEventWriter = {
  write(record: OutboxTrackingRecord): Promise<OutboxWriteResult>;
};
