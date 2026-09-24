import type { Pool } from "pg";
import type { BatchEnvelopeAcceptance, BatchEventOutcome } from "../server/batch-contract";
import { hashEnvelopePayload, payloadHashesEqual } from "./payload-hash";
import { recordBatchIngestOps, recordIngestStorageFailureOps } from "./ops-metrics";
import {
  assertEnvelopeScope,
  postgresAcceptReasonToIngest,
  siteIsRegistered,
  writeScopedEnvelopeInTransaction,
} from "./scoped-accept-write";
import type { PostgresScope } from "./scoped-store";

export type ScopedPostgresBatchAcceptanceOptions = PostgresScope & {
  readonly pool: Pool;
  /** When true (default), updates tracking.ops_site_counters from batch outcomes. */
  readonly recordOps?: boolean;
};

/**
 * PostgreSQL `BatchEnvelopeAcceptance` for a fixed tenant/site scope.
 * One transaction commits all new inbox + raw rows; business rejects are per-event outcomes.
 */
export const createScopedPostgresBatchAcceptance = (
  options: ScopedPostgresBatchAcceptanceOptions,
): BatchEnvelopeAcceptance => {
  const scope: PostgresScope = { tenantId: options.tenantId, siteId: options.siteId };
  const recordOps = options.recordOps ?? true;

  return {
    async acceptBatch(envelopes) {
      if (envelopes.length === 0) {
        return { ok: true, outcomes: [] };
      }

      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");

        if (!(await siteIsRegistered(client, scope))) {
          await client.query("ROLLBACK");
          return {
            ok: true,
            outcomes: envelopes.map((envelope) => ({
              event_id: envelope.event_id,
              status: "rejected" as const,
              reason: postgresAcceptReasonToIngest("unknown-site"),
            })),
          };
        }

        const outcomes: BatchEventOutcome[] = [];
        const batchPayloadHashById = new Map<string, Buffer>();

        for (const envelope of envelopes) {
          const scopeReject = assertEnvelopeScope(envelope, scope);
          if (scopeReject) {
            outcomes.push({
              event_id: envelope.event_id,
              status: "rejected",
              reason: postgresAcceptReasonToIngest(scopeReject.reason),
            });
            continue;
          }

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

          const written = await writeScopedEnvelopeInTransaction(client, scope, envelope);
          if (!written.ok) {
            outcomes.push({
              event_id: envelope.event_id,
              status: "rejected",
              reason: postgresAcceptReasonToIngest(written.reason),
            });
            continue;
          }
          outcomes.push({
            event_id: envelope.event_id,
            status: "accepted",
            duplicate: written.duplicate,
          });
        }

        await client.query("COMMIT");
        if (recordOps) {
          await recordBatchIngestOps(options.pool, scope, outcomes);
        }
        return { ok: true, outcomes };
      } catch {
        await client.query("ROLLBACK");
        if (recordOps) {
          await recordIngestStorageFailureOps(options.pool, scope, envelopes.length);
        }
        return { ok: false, retryable: true, reason: "storage-error" };
      } finally {
        client.release();
      }
    },
  };
};

/** Binds a site-registry scope to a shared pool (factory for collectors). */
export const createPostgresBatchAcceptanceForScope = (
  pool: Pool,
  scope: PostgresScope,
): BatchEnvelopeAcceptance => createScopedPostgresBatchAcceptance({ pool, ...scope });

export type PostgresBatchAcceptanceResolver = (scope: PostgresScope) => BatchEnvelopeAcceptance;

export const createPostgresBatchAcceptanceResolver = (input: {
  readonly pool: Pool;
}): PostgresBatchAcceptanceResolver => {
  const cache = new Map<string, BatchEnvelopeAcceptance>();
  return (scope) => {
    const key = `${scope.tenantId}\0${scope.siteId}`;
    let acceptance = cache.get(key);
    if (!acceptance) {
      acceptance = createScopedPostgresBatchAcceptance({ pool: input.pool, ...scope });
      cache.set(key, acceptance);
    }
    return acceptance;
  };
};

export const resolvePostgresBatchAcceptanceForSite = (input: {
  readonly pool: Pool;
  readonly tenantId: string;
  readonly siteId: string;
}): BatchEnvelopeAcceptance =>
  createScopedPostgresBatchAcceptance({
    pool: input.pool,
    tenantId: input.tenantId,
    siteId: input.siteId,
  });
