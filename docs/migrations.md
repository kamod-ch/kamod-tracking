# SQL migrations and rollback

Migrations are **additive** SQL files under `packages/core/migrations/`. Apply in filename order through **`006_ops_outcome_metrics.sql`**.

## Apply

```typescript
import { applyTrackingMigrations } from "@kamod-ch/tracking/postgres";
await applyTrackingMigrations(pool); // includes 002 roles by default
```

Test / CI fixture uses `applyTrackingMigrations(pool, { includeRoles: false })` to skip `002_tracking_roles.sql` when role grants are not needed.

Manual:

```sh
for f in packages/core/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## Rollback philosophy

This schema is designed for **forward-only** production rollout:

- New columns and tables use defaults or backfill `UPDATE`s (see **004**, **005**).
- Primary key changes (004 aggregates, dirty days) replace keys in place — **rollback to pre-004 grain is not supported** without restore from backup.
- Dropping `recompute_complete_from_received_at` or inbox `purpose` after **005** breaks retention/recompute semantics — do not partially revert 005.

### Safe operational rollback

| Situation                          | Action                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bad migration not yet in prod      | Do not apply; fix forward with a new migration file.                                             |
| Bad migration applied, no data yet | `DROP SCHEMA tracking CASCADE` in non-prod only; re-apply from 001.                              |
| Bad migration in prod with data    | Restore PostgreSQL snapshot; redeploy previous app version that matches schema generation.       |
| App regression                     | Roll back **application** binary; keep DB schema at latest migration unless restore is required. |

### Migration highlights

| File | Purpose                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 001  | Core tracking schema                                                                |
| 002  | Role grants (optional in tests)                                                     |
| 003  | Aggregates, retention policy, ops counters (initial metrics)                        |
| 004  | Aggregate dimension PK, dirty generation                                            |
| 005  | Recompute floor, inbox purpose, coverage gaps                                       |
| 006  | Extended ops metrics (conflict, retry, queue_discard, retention_run, dirty_backlog) |

See [aggregation.md](./aggregation.md) and [postgres-adapter.md](./postgres-adapter.md).
