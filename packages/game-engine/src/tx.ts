import { db } from "db";
import type { WsEventType } from "common";
import { postBroadcast } from "./broadcast";

// The transaction type Drizzle's node-postgres driver passes into a
// db.transaction callback. Every service function in this package takes a
// `Tx` (never the top-level `db`) for its mutations, so it composes inside
// a caller's transaction instead of accidentally opening a second one.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PendingBroadcast {
  eventId: string;
  type: WsEventType;
  data: unknown;
}

// Section 4: "WebSocket events only broadcast after a DB transaction
// commits" (Section 8.2 repeats it). Rather than trust every call site to
// remember "commit first, broadcast second," runInTransaction makes that
// structurally true: the callback can only *queue* broadcasts (via the
// `queueBroadcast` it receives), and they are only actually sent once
// db.transaction has returned — i.e. once Postgres has committed. If the
// transaction throws, the queue is discarded and nothing is sent.
export async function runInTransaction<T>(
  fn: (tx: Tx, queueBroadcast: (b: PendingBroadcast) => void) => Promise<T>,
): Promise<T> {
  const queued: PendingBroadcast[] = [];
  const result = await db.transaction(async (tx) => {
    return fn(tx, (b) => queued.push(b));
  });

  // Broadcast failures must never look like the command failed — the
  // write already committed. Log and move on; a reconnecting client will
  // still see the committed state on its next fetch/resync.
  await Promise.all(
    queued.map((b) =>
      postBroadcast(b).catch((err) => {
        console.error("Broadcast failed after commit:", b.type, b.eventId, err);
      }),
    ),
  );

  return result;
}
