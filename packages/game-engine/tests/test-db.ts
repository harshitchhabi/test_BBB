// Spins up a real Postgres to test against — not a mock, not pg-mem's
// approximation, but actual Postgres backend code (PGlite compiles real
// Postgres to WASM) exposed over a genuine TCP socket via
// @electric-sql/pglite-socket. That means the exact same `pg.Pool` +
// drizzle-orm/node-postgres stack packages/db and packages/game-engine use
// in production connects to it completely unchanged — these tests exercise
// the real transaction/row-lock code paths, not a simplified stand-in.
//
// No Docker or local Postgres install is available in this environment, so
// this is how Section 10's automated tests ("two simultaneous bids cannot
// overspend a balance", etc.) get run for real instead of only type-checked.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";

export interface TestDb {
  databaseUrl: string;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDb> {
  const pglite = new PGlite();
  const server = new PGLiteSocketServer({ db: pglite, port: 0 });
  await server.start();

  const address = (server as unknown as { server: { address: () => { port: number } } }).server.address();
  const port = address.port;
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;

  // Apply the exact migration files packages/db generates — this is the
  // same schema, same enums, same constraints production runs against.
  const migrationsFolder = path.resolve(__dirname, "../../db/migrations");
  const migratorPool = new Pool({ connectionString: databaseUrl });
  await migrate(drizzle(migratorPool), { migrationsFolder });
  await migratorPool.end();

  return {
    databaseUrl,
    stop: async () => {
      await server.stop();
      await pglite.close();
    },
  };
}
