// The entire backend service, deliberately. Compare to the legacy
// backend/websocket-server.ts, which embedded a full second copy of the
// bidding rules (in-memory sessions, hard-coded team IDs, direct DB writes)
// alongside backend/lib/bidding-manager.ts's *other* copy of the same
// rules. Neither survived a restart and nothing stopped them disagreeing.
//
// This process holds the WebSocket connections (which the serverless
// Next.js frontend cannot) and relays an already-committed event from
// packages/game-engine to every client watching that event — still with
// zero bidding/trading/scoring rules of its own (Section 3.1 #1 stays
// fixed: every rule lives in packages/game-engine, single-sourced). As of
// Phase 2 it also runs the timer-expiry sweep below, the one thing that
// genuinely needs a long-running process: nothing client-side is trusted
// to decide a lot's timer has run out (Section 5.3), and a serverless API
// route has no persistent interval to poll it. If this process crashes and
// restarts, no game state is lost — worst case, an already-expired lot
// gets closed a few seconds late once the sweep resumes.
import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { WsBroadcastEnvelope } from "common";
import { verifyWsTicket } from "common";
import { closeExpiredLots, closeExpiredCityAuctions } from "game-engine";

const PORT = Number(process.env.PORT ?? 8080);
const INTERNAL_BROADCAST_SECRET = process.env.INTERNAL_BROADCAST_SECRET;

// Constant-time secret comparison — this secret is shared only between
// our own two processes (not attacker-reachable in the intended
// deployment), but it's free to harden to the same standard as the
// session cookie's HMAC check.
function secretsMatch(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const TIMER_SWEEP_INTERVAL_MS = Number(process.env.TIMER_SWEEP_INTERVAL_MS ?? 2000);
const ENABLE_TIMER_SWEEP = process.env.ENABLE_TIMER_SWEEP !== "false";

if (!INTERNAL_BROADCAST_SECRET) {
  console.warn(
    "⚠️  INTERNAL_BROADCAST_SECRET is not set. /internal/broadcast will reject every request until it is.",
  );
}

// eventId -> connected sockets watching that event.
const rooms = new Map<string, Set<WebSocket>>();

function joinRoom(eventId: string, ws: WebSocket) {
  let room = rooms.get(eventId);
  if (!room) {
    room = new Set();
    rooms.set(eventId, room);
  }
  room.add(ws);
}

function leaveAllRooms(ws: WebSocket) {
  for (const [eventId, room] of rooms) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(eventId);
  }
}

function broadcastToRoom(eventId: string, payload: unknown) {
  const room = rooms.get(eventId);
  if (!room) return 0;
  const message = JSON.stringify(payload);
  let sent = 0;
  for (const client of room) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent++;
    }
  }
  return sent;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  if (req.method === "POST" && req.url === "/internal/broadcast") {
    if (!INTERNAL_BROADCAST_SECRET || !secretsMatch(req.headers["x-internal-secret"], INTERNAL_BROADCAST_SECRET)) {
      res.writeHead(401).end("unauthorized");
      return;
    }

    try {
      const body = (await readJsonBody(req)) as WsBroadcastEnvelope;
      if (!body.eventId || !body.type) {
        res.writeHead(400).end("eventId and type are required");
        return;
      }
      const sent = broadcastToRoom(body.eventId, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sent }));
    } catch (err) {
      console.error("Bad broadcast request:", err);
      res.writeHead(400).end("invalid body");
    }
    return;
  }

  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "join" && typeof message.eventId === "string") {
        if (
          !INTERNAL_BROADCAST_SECRET ||
          typeof message.ticket !== "string" ||
          !verifyWsTicket(INTERNAL_BROADCAST_SECRET, message.ticket, message.eventId)
        ) {
          ws.send(JSON.stringify({ type: "join_rejected", eventId: message.eventId }));
          return;
        }
        joinRoom(message.eventId, ws);
        ws.send(JSON.stringify({ type: "joined", eventId: message.eventId }));
      } else if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      // Malformed client message — ignore rather than drop the connection;
      // this relay never needs to trust client input for anything but the
      // room it wants to join.
    }
  });

  ws.on("close", () => leaveAllRooms(ws));
  ws.on("error", () => leaveAllRooms(ws));
});

server.listen(PORT, () => {
  console.log(`Broadcast relay listening on :${PORT} (ws path /ws, POST /internal/broadcast)`);
});

let sweepTimer: NodeJS.Timeout | null = null;
if (ENABLE_TIMER_SWEEP) {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠️  ENABLE_TIMER_SWEEP is on but DATABASE_URL is not set — the sweep will error every tick.");
  }
  sweepTimer = setInterval(() => {
    closeExpiredLots().catch((err) => console.error("Timer sweep failed (auction lots):", err));
    closeExpiredCityAuctions().catch((err) => console.error("Timer sweep failed (city auctions):", err));
  }, TIMER_SWEEP_INTERVAL_MS);
  console.log(`Timer sweep running every ${TIMER_SWEEP_INTERVAL_MS}ms.`);
} else {
  console.log("Timer sweep disabled (ENABLE_TIMER_SWEEP=false).");
}

process.on("SIGTERM", () => {
  if (sweepTimer) clearInterval(sweepTimer);
  wss.close(() => server.close(() => process.exit(0)));
});
