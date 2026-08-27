"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";

// Section 7.9 Trade desk controls: register, approve/reject, complete, or
// cancel trades.
export default function ModeratorTradesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [trades, setTrades] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/trades/list`);
    if (res.ok) setTrades((await res.json()).trades);
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(json.message ?? `Error (${res.status})`);
      else refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 900 }}>
      <ModNav eventId={eventId} />
      <h1>Trade Desk</h1>
      {message && <p style={{ color: "crimson" }}>{message}</p>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ textAlign: "left" }}>#</th><th style={{ textAlign: "left" }}>Teams</th><th>Lines</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td>{t.tradeNumber}</td>
              <td>{t.proposerTeamName} ↔ {t.counterpartyTeamName}</td>
              <td>
                {t.lines.map((l: any, i: number) => (
                  <div key={i}>{l.fromTeamName} gives {l.quantity} {l.material?.name}</div>
                ))}
              </td>
              <td>{t.status}{t.binding ? " (pink slip)" : ""}</td>
              <td>
                {t.status === "submitted" && (
                  <>
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/register`)}>Register</button>
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/reject`, { reason: "Rejected by moderator." })}>Reject</button>
                  </>
                )}
                {t.status === "registered" && (
                  <button disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/complete`)}>Complete</button>
                )}
                {(t.status === "submitted" || t.status === "registered") && (
                  <button disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/cancel`, { reason: "Cancelled by moderator." })}>Cancel</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
