import { prepareContractEnvelope, type ContractIngestOptions } from "../core/contract-ingest";
import type { IngestResult, IngestRejectReason } from "../core/types";
import { eventIdFromOutboxId, type OutboxTrackingRecord } from "./outbox";
import type { PublicIngestSite } from "./site-registry";

/**
 * Reject client claims that would override authenticated ingest scope.
 */
export const rejectForbiddenOutboxScopeClaims = (
  record: Record<string, unknown>,
  site: PublicIngestSite,
): IngestRejectReason | undefined => {
  if (record.producer === "browser" || record.origin === "browser") {
    return "producer-not-allowed";
  }
  for (const key of ["tenant_id", "tenantId"] as const) {
    const value = record[key];
    if (typeof value === "string" && value !== site.tenantId) {
      return "invalid-payload";
    }
  }
  for (const key of ["site_id", "siteId"] as const) {
    const value = record[key];
    if (typeof value === "string" && value !== site.siteId) {
      return "invalid-payload";
    }
  }
  const appId = record.appId;
  if (typeof appId === "string" && appId !== site.appId) {
    return "unknown-app";
  }
  return undefined;
};

export const outboxRecordToSubmitted = (
  site: PublicIngestSite,
  outbox: OutboxTrackingRecord,
): import("../core/types").SubmittedEvent => ({
  appId: site.appId,
  id: eventIdFromOutboxId(outbox.outboxId),
  name: outbox.eventName,
  schemaVersion: outbox.schemaVersion,
  origin: "server",
  collectedAt: outbox.occurredAt,
  businessSubject: outbox.subject,
  properties: {
    ...outbox.properties,
    ...(outbox.pseudonymousAccountRef !== undefined
      ? { pseudonymous_account_ref: outbox.pseudonymousAccountRef }
      : {}),
  },
});

export const prepareValidatedOutboxEnvelope = async (
  site: PublicIngestSite,
  contract: ContractIngestOptions,
  outbox: OutboxTrackingRecord,
): Promise<IngestResult> =>
  prepareContractEnvelope(contract, outboxRecordToSubmitted(site, outbox));
