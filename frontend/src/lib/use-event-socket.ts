"use client";

import { useEffect, useRef, useState } from "react";

// Connects to backend/'s relay (see backend/src/index.ts), joins one
// event's room, and calls onMessage for every broadcast the engine sends
// after a commit. This is a live-update *nudge* — the actual state always
// comes from re-fetching /api/events/:id/auction-state, never from
// trusting the WS payload's shape directly, so a missed message or a
// reconnect never leaves the screen showing stale-but-unrecoverable data.
//
// Task 6: this used to open a brand-new WebSocket every time a component
// called this hook, and close it on unmount — which meant every single
// tab switch (Live Auction -> Inventory -> Trade & Build, ...) tore down
// and rebuilt the connection from scratch, since each page is its own
// component that Next.js mounts/unmounts on navigation. That's the "laggy
// tab switching": a fresh TCP + WS handshake + join round-trip on every
// click, not a rendering problem. Fixed by keeping ONE real WebSocket per
// eventId in a module-level, reference-counted registry — the first page
// to ask for an eventId's socket opens it; every other page under the
// same event just subscribes an extra listener to the connection that's
// already open; the actual socket only closes once nothing is listening
// anymore (with a short grace period so a fast page-to-page navigation,
// where the old page's cleanup and the new page's setup both fire within
// the same tick, never closes and immediately reopens it).
type MessageListener = (msg: { type: string; data: unknown }) => void;
type StatusListener = (connected: boolean) => void;

interface SocketEntry {
  ws: WebSocket | null;
  connected: boolean;
  refCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  messageListeners: Set<MessageListener>;
  statusListeners: Set<StatusListener>;
}

const registry = new Map<string, SocketEntry>();
const CLOSE_GRACE_MS = 500;

function getOrCreateEntry(eventId: string): SocketEntry {
  let entry = registry.get(eventId);
  if (!entry) {
    entry = {
      ws: null,
      connected: false,
      refCount: 0,
      reconnectTimer: null,
      closeTimer: null,
      messageListeners: new Set(),
      statusListeners: new Set(),
    };
    registry.set(eventId, entry);
  }
  return entry;
}

function setConnected(entry: SocketEntry, value: boolean) {
  if (entry.connected === value) return;
  entry.connected = value;
  for (const listen of entry.statusListeners) listen(value);
}

async function connectSocket(eventId: string, entry: SocketEntry) {
  // Security hardening: the relay is a different origin/port than the
  // frontend, so the httpOnly session cookie never reaches it — without
  // a ticket, anyone who knew this event's UUID could join its room and
  // silently receive every broadcast with zero authentication. Fetch a
  // short-lived signed ticket (mint side does the real "is this
  // participant actually part of this event" check) before opening the
  // socket at all; if that fails (signed out, not part of the event),
  // don't open a socket this call can't authenticate.
  let ticket: string;
  try {
    const res = await fetch(`/api/events/${eventId}/ws-ticket`);
    if (!res.ok) return;
    ({ ticket } = await res.json());
  } catch {
    return;
  }
  // Acquire may have been released (and the entry deleted from the
  // registry) while this ticket fetch was in flight.
  if (registry.get(eventId) !== entry) return;

  const url = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
  const ws = new WebSocket(url);
  entry.ws = ws;

  ws.onopen = () => {
    setConnected(entry, true);
    ws.send(JSON.stringify({ type: "join", eventId, ticket }));
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type && msg.type !== "joined" && msg.type !== "pong") {
        for (const listen of entry.messageListeners) listen(msg);
      }
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => {
    setConnected(entry, false);
    // Only auto-reconnect while something is still actually listening —
    // a socket that hit refCount 0 is being torn down deliberately, not
    // dropped, so it shouldn't schedule itself back to life.
    if (entry.refCount > 0) {
      entry.reconnectTimer = setTimeout(() => connectSocket(eventId, entry), 2000);
    }
  };
  ws.onerror = () => ws.close();
}

function acquire(eventId: string): SocketEntry {
  const entry = getOrCreateEntry(eventId);
  if (entry.closeTimer) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
  }
  entry.refCount++;
  if (entry.refCount === 1 && !entry.ws) {
    connectSocket(eventId, entry);
  }
  return entry;
}

function release(eventId: string, entry: SocketEntry) {
  entry.refCount--;
  if (entry.refCount > 0) return;
  // Grace period, not an immediate close: if the very next page under
  // the same event mounts and calls acquire() again before this fires,
  // the timer above gets cancelled and the same connection just keeps
  // running — no reconnect flicker for a normal tab switch.
  entry.closeTimer = setTimeout(() => {
    if (entry.refCount > 0) return; // something re-acquired in the meantime
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.ws?.close();
    entry.ws = null;
    registry.delete(eventId);
  }, CLOSE_GRACE_MS);
}

export function useEventSocket(eventId: string | null, onMessage: MessageListener) {
  const [connected, setConnectedState] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!eventId) return;
    const entry = acquire(eventId);
    setConnectedState(entry.connected);

    const messageListener: MessageListener = (msg) => onMessageRef.current(msg);
    const statusListener: StatusListener = (value) => setConnectedState(value);
    entry.messageListeners.add(messageListener);
    entry.statusListeners.add(statusListener);

    return () => {
      entry.messageListeners.delete(messageListener);
      entry.statusListeners.delete(statusListener);
      release(eventId, entry);
    };
  }, [eventId]);

  return { connected };
}
