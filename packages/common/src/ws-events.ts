// The exact broadcast event list from EVENT_PORTAL_IMPLEMENTATION_PLAN.md
// Section 8.2. Every one of these is emitted by packages/game-engine only
// AFTER its owning database transaction has committed — see
// packages/game-engine/src/broadcast.ts. Nothing upstream of a commit ever
// reaches a client.
export const WS_EVENT_TYPES = [
  "event.stage_changed",
  "auction.round_started",
  "auction.lot_opened",
  "auction.bid_accepted",
  "auction.lot_closed",
  "inventory.changed",
  "trade.changed",
  "building.constructed",
  "inspection.resolved",
  "city.auction_opened",
  "city.bid_accepted",
  "city.assigned",
  "score.revealed",
  "moderator.announcement",
] as const;

export type WsEventType = (typeof WS_EVENT_TYPES)[number];

// A broadcast is always scoped to one event (Section 4: "Event scoped:
// every team, lot, recipe, city, and transaction belongs to an event") so
// the relay (backend/) can route it only to sockets that joined that
// event's room, never cross-event.
export interface WsBroadcastEnvelope<T = unknown> {
  eventId: string;
  type: WsEventType;
  data: T;
}
