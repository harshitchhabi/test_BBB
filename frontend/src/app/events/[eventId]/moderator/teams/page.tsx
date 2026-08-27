"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";

// Section 7.9 "Teams & Balances" + "Incidents" (team withdrawal, balance
// adjustment, manual correction) combined into one screen.
export default function ModeratorTeamsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
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

  if (!overview) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 1000 }}>
      <ModNav eventId={eventId} />
      <h1>Teams & Incidents</h1>
      {message && <p style={{ color: "crimson" }}>{message}</p>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Team</th>
            <th style={{ textAlign: "right" }}>Auction tokens</th>
            <th style={{ textAlign: "right" }}>City wallet</th>
            <th>Trades</th>
            <th>Status</th>
            <th>Adjust</th>
            <th>Incident</th>
          </tr>
        </thead>
        <tbody>
          {overview.teams.map((t: any) => (
            <tr key={t.id}>
              <td>{t.name} ({t.code})</td>
              <td style={{ textAlign: "right" }}>{t.auctionTokens}</td>
              <td style={{ textAlign: "right" }}>{t.cityWalletTokens}</td>
              <td style={{ textAlign: "center" }}>{t.tradeCount}</td>
              <td>{t.status}</td>
              <td>
                <input
                  style={{ width: 70 }}
                  placeholder="±tokens"
                  value={adjustAmount[t.id] ?? ""}
                  onChange={(e) => setAdjustAmount((a) => ({ ...a, [t.id]: e.target.value }))}
                />
                <button
                  disabled={busy || !adjustAmount[t.id]}
                  onClick={() =>
                    call(`/api/events/${eventId}/teams/${t.id}/adjust-tokens`, {
                      auctionTokensDelta: Number(adjustAmount[t.id]),
                      reason: reason[t.id] || "Manual correction.",
                    })
                  }
                >
                  Apply
                </button>
              </td>
              <td>
                {t.status === "active" ? (
                  <>
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/teams/${t.id}/status`, { status: "withdrawn", reason: "Team withdrew." })}>Withdraw</button>
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/teams/${t.id}/status`, { status: "disqualified", reason: "Disqualified by moderator." })}>Disqualify</button>
                  </>
                ) : (
                  <button disabled={busy} onClick={() => call(`/api/events/${eventId}/teams/${t.id}/status`, { status: "active", reason: "Reinstated." })}>Reinstate</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: "1rem" }}>
        <input
          placeholder="Reason for adjustments/incidents (shared field for this session)"
          style={{ width: 400 }}
          onChange={(e) => setReason((r) => Object.fromEntries(overview.teams.map((t: any) => [t.id, e.target.value])))}
        />
      </p>
    </main>
  );
}
