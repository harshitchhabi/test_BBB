"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import type { AuctionStateResponse } from "@/lib/auction-state-types";

// Section 7.8/7.9 moderator console — Stage 1 Auction Control slice only
// (start round, open next lot, close lot). Every button here calls the
// same command endpoints a script or a future automated test would; this
// page has no authority of its own — the server re-checks staff status on
// every request regardless of whether this page would have shown the
// button.
export default function ModeratorAuctionPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [state, setState] = useState<AuctionStateResponse | null>(null);
  const [materialTypeId, setMaterialTypeId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/auction-state`);
    if (res.ok) setState(await res.json());
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());

  // Same reconnect-refetch fix as the team Live Auction screen — don't
  // rely on a broadcast happening to arrive after the socket comes back.
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
      else await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status !== "authenticated") return <main style={{ padding: "2rem" }}>Sign in as a moderator.</main>;
  if (!state) return <main style={{ padding: "2rem" }}>Loading…</main>;
  if (!state.isStaff) return <main style={{ padding: "2rem" }}>You are not staff for this event.</main>;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 800 }}>
      <h1>Stage 1 Auction Control</h1>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Start a round</h2>
        <p style={{ color: "#666" }}>
          Enter the material type ID to auction next (moderator setup screens for browsing materials land alongside Phase
          3's build desk).
        </p>
        <input value={materialTypeId} onChange={(e) => setMaterialTypeId(e.target.value)} placeholder="material type id" style={{ width: 320 }} />
        <button disabled={busy || !materialTypeId} onClick={() => call(`/api/events/${eventId}/auction-rounds`, { materialTypeId })}>
          Start round
        </button>
      </section>

      {state.activeRound && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2>
            Round {state.activeRound.sequence}: {state.activeRound.materialName ?? state.activeRound.materialKey}
          </h2>
          {state.activeRound.shock && (
            <p>
              ⚡ {state.activeRound.shock.title} — {state.activeRound.shock.description}
            </p>
          )}
          <p>{state.pendingLotsCount} lot(s) still pending in this round.</p>

          {state.liveLot ? (
            <div>
              <p>
                Live: lot #{state.liveLot.lotNumber} — opening {state.liveLot.openingBid}, next min {state.liveLot.nextMinimumBid}
              </p>
              <p>Current highest: {state.liveLot.currentHighestBid ? state.liveLot.currentHighestBid.amount : "none"}</p>
              <button disabled={busy} onClick={() => call(`/api/events/${eventId}/auction-lots/${state.liveLot!.id}/close`, { reason: "Moderator closed the lot." })}>
                Close lot
              </button>
            </div>
          ) : (
            <button disabled={busy} onClick={() => call(`/api/events/${eventId}/auction-rounds/${state.activeRound!.id}/open-next-lot`)}>
              Open next lot
            </button>
          )}
        </section>
      )}

      {message && <p style={{ color: "crimson" }}>{message}</p>}

      <section>
        <h3>Teams</h3>
        <ul>
          {state.teams.map((t) => (
            <li key={t.id}>
              {t.name}: {t.auctionTokens} tokens ({t.status})
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
