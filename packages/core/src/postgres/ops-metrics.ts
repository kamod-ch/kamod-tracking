import type { Pool } from "pg";
import type { OpsMetric } from "../aggregation/types";

export type OpsCounterIncrement = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly metric: OpsMetric;
  readonly delta?: number;
  readonly rejectReason?: string;
  readonly schemaVersion?: number;
};

/** Low-cardinality counters — never pass event_id or subject ids as labels. */
export const incrementOpsCounter = async (
  pool: Pick<Pool, "query">,
  input: OpsCounterIncrement,
): Promise<void> => {
  const delta = input.delta ?? 1;
  await pool.query(
    `INSERT INTO tracking.ops_site_counters (
       tenant_id, site_id, metric, reject_reason, schema_version, counter
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, site_id, metric, reject_reason, schema_version)
     DO UPDATE SET counter = tracking.ops_site_counters.counter + EXCLUDED.counter,
                   updated_at = (now() AT TIME ZONE 'utc')`,
    [
      input.tenantId,
      input.siteId,
      input.metric,
      input.rejectReason ?? "",
      input.schemaVersion ?? 0,
      delta,
    ],
  );
};
