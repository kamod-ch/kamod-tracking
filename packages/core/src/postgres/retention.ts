import type { Pool, PoolClient } from "pg";
import type { SiteRetentionPolicy } from "../aggregation/types";

export type RetentionRunResult = {
  readonly eventsDeleted: number;
  readonly inboxDeleted: number;
  readonly aggregatesDeleted: number;
};

const daysAgoUtc = (days: number, now: Date): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60_000);

export const runPurposeRetention = async (
  pool: Pick<Pool, "connect">,
  policy: SiteRetentionPolicy,
  now: Date = new Date(),
): Promise<RetentionRunResult> => {
  const client = await pool.connect();
  let eventsDeleted = 0;
  let inboxDeleted = 0;
  let aggregatesDeleted = 0;
  try {
    await client.query("BEGIN");

    if (policy.rawRetentionDays !== null && policy.rawRetentionDays > 0) {
      const cutoff = daysAgoUtc(policy.rawRetentionDays, now);
      const deleted = await client.query(
        `DELETE FROM tracking.events
         WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3 AND received_at < $4::timestamptz`,
        [policy.tenantId, policy.siteId, policy.purpose, cutoff.toISOString()],
      );
      eventsDeleted = deleted.rowCount ?? 0;
      await refreshRawWatermark(client, policy, now);
    }

    if (policy.inboxRetentionDays !== null && policy.inboxRetentionDays > 0) {
      const cutoff = daysAgoUtc(policy.inboxRetentionDays, now);
      const deleted = await client.query(
        `DELETE FROM tracking.event_inbox i
         USING tracking.events e
         WHERE i.tenant_id = e.tenant_id AND i.site_id = e.site_id AND i.event_id = e.event_id
           AND i.tenant_id = $1 AND i.site_id = $2 AND e.purpose = $3
           AND i.first_received_at < $4::timestamptz
           AND NOT EXISTS (
             SELECT 1 FROM tracking.events ev
             WHERE ev.tenant_id = i.tenant_id AND ev.site_id = i.site_id AND ev.event_id = i.event_id
           )`,
        [policy.tenantId, policy.siteId, policy.purpose, cutoff.toISOString()],
      );
      inboxDeleted = deleted.rowCount ?? 0;
    }

    if (policy.aggregateRetentionDays !== null && policy.aggregateRetentionDays > 0) {
      const cutoffDate = formatUtcDate(daysAgoUtc(policy.aggregateRetentionDays, now));
      const deleted = await client.query(
        `DELETE FROM tracking.daily_aggregates
         WHERE tenant_id = $1 AND site_id = $2 AND local_date < $3::date`,
        [policy.tenantId, policy.siteId, cutoffDate],
      );
      aggregatesDeleted = deleted.rowCount ?? 0;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { eventsDeleted, inboxDeleted, aggregatesDeleted };
};

const formatUtcDate = (instant: Date): string => instant.toISOString().slice(0, 10);

export const refreshRawWatermark = async (
  client: PoolClient,
  policy: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
  _now: Date,
): Promise<void> => {
  const oldest = await client.query<{ oldest: Date | null }>(
    `SELECT MIN(received_at) AS oldest FROM tracking.events
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3`,
    [policy.tenantId, policy.siteId, policy.purpose],
  );
  const value = oldest.rows[0]?.oldest;
  if (!value) {
    await client.query(
      `DELETE FROM tracking.raw_data_watermark
       WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3`,
      [policy.tenantId, policy.siteId, policy.purpose],
    );
    return;
  }
  await client.query(
    `INSERT INTO tracking.raw_data_watermark (tenant_id, site_id, purpose, oldest_received_at)
     VALUES ($1,$2,$3,$4::timestamptz)
     ON CONFLICT (tenant_id, site_id, purpose) DO UPDATE
       SET oldest_received_at = EXCLUDED.oldest_received_at,
           updated_at = (now() AT TIME ZONE 'utc')`,
    [policy.tenantId, policy.siteId, policy.purpose, value.toISOString()],
  );
};
