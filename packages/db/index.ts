// packages/db/index.ts
// Same shape as the legacy packages/db/index.ts (drizzle + node-postgres
// Pool + re-exported `eq`), just pointed at the new schema/ directory.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { eq, ne, and, or, sql, desc, asc, inArray } from "drizzle-orm";

// DB_POOL_MAX exists purely for the pglite-socket-backed test harness
// (packages/game-engine/tests/test-db.ts), which cannot reliably service
// more than one concurrent socket connection. Leave it unset in every real
// deployment — pg.Pool's normal default (10) applies.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined,
});
export const db = drizzle(pool, { schema });
export { eq, ne, and, or, sql, desc, asc, inArray, pool };
