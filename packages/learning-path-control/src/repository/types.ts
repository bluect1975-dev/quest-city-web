import type { Pool, PoolClient } from "pg";

/** Same shape as every other package's Queryable (e.g. @quest-city-web/student-support) -- accepts either a pool (auto-managed connection) or a transaction-bound client. */
export type Queryable = Pool | PoolClient;
