"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";

// Section 7.9 Stage 3 controls: start city, accept/close bid, assign last
// city, reveal multipliers. Score & Reveal folds into this screen too —
// there's no separate "reveal" screen since revealCitiesAndScore is one
// atomic action (see docs/phase-4.md).
export default function ModeratorCitiesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [auctions, setAuctions] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
    const c = await fetch(`/api/events/${eventId}/cities`).then((r) => r.json());
    setCities(c.cities);
    const a = await fetch(`/api/events/${eventId}/city-auctions/list`).then((r) => r.json());
    setAuctions(a.auctions);
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

  const liveAuctionByCity = new Map(auctions.filter((a) => a.status === "live").map((a) => [a.cityId, a]));
  const teamsWithoutCity = overview.teams.filter((t: any) => !cities.some((c: any) => c.assignedTeamId === t.id));

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 1000 }}>
      <ModNav eventId={eventId} />
      <h1>Stage 3: Cities & Reveal</h1>
      {message && <p style={{ color: "crimson" }}>{message}</p>}

      <button
        disabled={busy}
        onClick={() => call(`/api/events/${eventId}/cities/reveal`)}
        style={{ background: "#900", color: "white", padding: "0.5rem 1rem", marginBottom: "1rem" }}
      >
        Reveal all multipliers & finalize scores
      </button>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ textAlign: "left" }}>City</th><th>Tier</th><th>Status</th><th>Winner</th><th></th></tr>
        </thead>
        <tbody>
          {cities.map((c) => {
            const live = liveAuctionByCity.get(c.id);
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td style={{ textAlign: "center" }}>{c.tier}</td>
                <td>{c.assignedTeamId ? "sold" : live ? "live" : "unsold"}</td>
                <td>{c.assignedTeamId ? overview.teams.find((t: any) => t.id === c.assignedTeamId)?.name : "—"}</td>
                <td>
                  {!c.assignedTeamId && !live && (
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/cities/${c.id}/start-auction`)}>Start auction</button>
                  )}
                  {live && (
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/city-auctions/${live.id}/close`)}>Close</button>
                  )}
                  {!c.assignedTeamId && !live && teamsWithoutCity.length === 1 && (
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/cities/${c.id}/assign-last`, { teamId: teamsWithoutCity[0].id })}>
                      Assign to {teamsWithoutCity[0].name} (last team)
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
