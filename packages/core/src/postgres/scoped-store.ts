import type { Pool, PoolClient } from "pg";
import type { TrackingEventEnvelope } from "../core/envelope";
import { deserializeTrackingEvent } from "../core/serialize";
import type { EnvelopeStore } from "../core/envelope-store";
import { hashEnvelopePayload } from "./payload-hash";
import { siteIsRegistered, writeScopedEnvelopeInTransaction } from "./scoped-accept-write";

export type PostgresScope = {
  readonly tenantId: string;
  readonly siteId: string;
};

export type PostgresAcceptResult =
  | { readonly ok: true; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: "payload-conflict" | "unknown-site" | "scope-mismatch" };

export type ScopedPostgresEnvelopeStore = EnvelopeStore & {
  acceptEnvelope(envelope: TrackingEventEnvelope): Promise<PostgresAcceptResult>;
};

export type ScopedPostgresStoreOptions = PostgresScope & {
  readonly pool: Pool;
};

export const createScopedPostgresEnvelopeStore = (
  options: ScopedPostgresStoreOptions,
): ScopedPostgresEnvelopeStore => {
  const scope = { tenantId: options.tenantId, siteId: options.siteId };

  const acceptEnvelope = async (envelope: TrackingEventEnvelope): Promise<PostgresAcceptResult> => {
    const client = await options.pool.connect();
    try {
      await client.query("BEGIN");
      if (!(await siteIsRegistered(client, scope))) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "unknown-site" };
      }
      const result = await writeScopedEnvelopeInTransaction(client, scope, envelope);
      if (!result.ok) {
        await client.query("ROLLBACK");
        return result;
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    acceptEnvelope,
    async append(envelope) {
      const result = await acceptEnvelope(envelope);
      if (!result.ok) {
        throw new Error(`postgres-append-failed:${result.reason}`);
      }
      return { duplicate: result.duplicate };
    },
    async get(eventId) {
      const result = await options.pool.query<{ payload: unknown }>(
        `SELECT payload FROM tracking.events
         WHERE tenant_id = $1 AND site_id = $2 AND event_id = $3`,
        [scope.tenantId, scope.siteId, eventId],
      );
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }
      return deserializeTrackingEvent(row.payload);
    },
    async list() {
      const result = await options.pool.query<{ payload: unknown }>(
        `SELECT payload FROM tracking.events
         WHERE tenant_id = $1 AND site_id = $2
         ORDER BY occurred_at ASC`,
        [scope.tenantId, scope.siteId],
      );
      return result.rows
        .map((row) => deserializeTrackingEvent(row.payload))
        .filter((event): event is TrackingEventEnvelope => event !== undefined);
    },
  };
};

export const seedTrackingSite = async (
  pool: Pool,
  input: PostgresScope & { readonly appId: string; readonly settings?: Record<string, unknown> },
): Promise<void> => {
  await pool.query(
    `INSERT INTO tracking.tenants (tenant_id) VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [input.tenantId],
  );
  await pool.query(
    `INSERT INTO tracking.sites (tenant_id, site_id, app_id, settings)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, site_id) DO UPDATE SET app_id = EXCLUDED.app_id`,
    [input.tenantId, input.siteId, input.appId, JSON.stringify(input.settings ?? {})],
  );
};

export const countStoredEvents = async (pool: Pool, scope: PostgresScope): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM tracking.events
     WHERE tenant_id = $1 AND site_id = $2`,
    [scope.tenantId, scope.siteId],
  );
  return Number(result.rows[0]?.count ?? 0);
};

export const countInboxRows = async (pool: Pool, scope: PostgresScope): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM tracking.event_inbox
     WHERE tenant_id = $1 AND site_id = $2`,
    [scope.tenantId, scope.siteId],
  );
  return Number(result.rows[0]?.count ?? 0);
};

/** Test helper: force event insert failure after inbox row (must roll back inbox). */
export const acceptEnvelopeWithForcedEventFailure = async (
  client: PoolClient,
  scope: PostgresScope,
  envelope: TrackingEventEnvelope,
): Promise<void> => {
  const payloadHash = hashEnvelopePayload(envelope);
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO tracking.event_inbox (tenant_id, site_id, event_id, payload_hash, purpose, first_received_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [
        scope.tenantId,
        scope.siteId,
        envelope.event_id,
        payloadHash,
        envelope.purpose ?? "analytics",
        envelope.received_at,
      ],
    );
    await client.query(`SELECT pg_sleep(0)`);
    throw new Error("forced-event-insert-failure");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};
