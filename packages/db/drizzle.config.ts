import { type Config } from "drizzle-kit";
import * as dotenv from "dotenv";
dotenv.config();

// Kept identical in shape to the legacy packages/db/drizzle.config.ts so the
// Drizzle conventions (schema location, migrations output, postgres dialect)
// carry over unchanged. Only the schema entrypoint changes: it now points at
// the schema/ directory instead of a single flat schema.ts file, because the
// event-scoped model (Section 5 of the implementation plan) is large enough
// to split by domain (identity, materials, auction, inventory, buildings,
// cities, scoring).
export default {
  schema: "./schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
