"use client";

import { useEffect, useRef, useState } from "react";

// Connects to backend/'s relay (see backend/src/index.ts), joins one
// event's room, and calls onMessage for every broadcast the engine sends
// after a commit. This is a live-update *nudge* — the actual state always
// comes from re-fetching /api/events/:id/auction-state, never from
// trusting the WS payload's shape directly, so a missed message or a
// reconnect never leaves the screen showing stale-but-unrecoverable data.
export function useEventSocket(eventId: string | null, onMessage: (msg: { type: string; data: unknown }) => void) {
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!eventId) return;
    const url = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByCleanup = false;

    function connect() {
      ws = new WebSocket(url);
      ws.onopen = () => {
        setConnected(true);
        ws?.send(JSON.stringify({ type: "join", eventId }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type && msg.type !== "joined" && msg.type !== "pong") {
            onMessageRef.current(msg);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedByCleanup) reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [eventId]);

  return { connected };
}
