// packages/db/index.ts
// Same shape as the legacy packages/db/index.ts (drizzle + node-postgres
// Pool + re-exported `eq`), just pointed at the new schema/ directory.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { eq, and, sql } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export { eq, and, sql };
