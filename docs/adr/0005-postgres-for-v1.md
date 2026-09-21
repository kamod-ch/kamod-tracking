# 5. PostgreSQL is enough for version 1

When a durable adapter exists, PostgreSQL is the V1 store. Kafka, Redis, and ClickHouse are not prerequisites.

`@kamod-ch/tracking/postgres` is **not exported** until that adapter is implemented. No `pg` / `postgres` dependency is added until then. In-memory storage is sufficient for local development and tests.
