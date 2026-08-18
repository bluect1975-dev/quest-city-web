import type { Pool, PoolClient } from "pg";

/** Accepts either a pool (auto-managed connection) or a transaction-bound client. */
export type Queryable = Pool | PoolClient;
