"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import type { AuctionStateResponse } from "@/lib/auction-state-types";

// Section 7.3 Live Auction screen — team-facing. All members can watch;
// only the authenticated team leader can submit a bid (enforced
// server-side by placeBid regardless of what this page shows, per Section
// 8.3 — the disabled button here is a courtesy, not the actual guard).
export default function LiveAuctionPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [state, setState] = useState<AuctionStateResponse | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/auction-state`);
    if (res.ok) setState(await res.json());
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  // Any of these broadcasts means the screen is stale — just refetch the
  // read-model rather than trying to hand-patch state from the WS payload.
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => {
    refresh();
  });

  // A dropped-then-restored connection (phone locked, wifi blip, relay
  // restart) can miss whatever broadcasts fired while it was down — Phase
  // 5 rehearsal scenario "a server or browser restarts during a live
  // lot." Refetching the instant the socket reconnects, not only when a
  // message happens to arrive afterward, is what actually closes that gap.
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  async function submitBid() {
    if (!state?.liveLot || !state.myTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/auction-lots/${state.liveLot.id}/bids`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: state.myTeamId, amount: Number(bidAmount) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Bid rejected.");
      } else {
        setBidAmount("");
        refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") return <main style={{ padding: "2rem" }}>Loading…</main>;
  if (status === "unauthenticated") return <main style={{ padding: "2rem" }}>Sign in to view the auction.</main>;
  if (!state) return <main style={{ padding: "2rem" }}>Loading auction state…</main>;

  const myTeam = state.teams.find((t) => t.id === state.myTeamId);
  const canBid = state.myRole === "leader" && state.liveLot != null;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 720 }}>
      <h1>Stage 1: Material Auction</h1>

      {state.activeRound ? (
        <p>
          Round {state.activeRound.sequence}: <strong>{state.activeRound.materialName ?? state.activeRound.materialKey}</strong>
          {state.activeRound.shock && (
            <span style={{ marginLeft: 8, color: "#a05a00" }}>
              ⚡ {state.activeRound.shock.title} — {state.activeRound.shock.description}
            </span>
          )}
        </p>
      ) : (
        <p>Waiting for the moderator to start a round…</p>
      )}

      {state.liveLot ? (
        <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", marginTop: "1rem" }}>
          <h2>
            Lot #{state.liveLot.lotNumber} — {state.liveLot.materialName ?? state.liveLot.materialKey}
          </h2>
          <p>Opening bid: {state.liveLot.openingBid}</p>
          <p>
            Current highest: {state.liveLot.currentHighestBid ? `${state.liveLot.currentHighestBid.amount} tokens` : "No bids yet"}
          </p>
          <p>Next minimum bid: {state.liveLot.nextMinimumBid}</p>
          {state.liveLot.closesAt && <p>Closes at: {new Date(state.liveLot.closesAt).toLocaleTimeString()}</p>}

          {canBid ? (
            <div style={{ display: "flex", gap: 8, marginTop: "0.5rem" }}>
              <input
                type="number"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                placeholder={String(state.liveLot.nextMinimumBid)}
              />
              <button onClick={submitBid} disabled={submitting || !bidAmount}>
                {submitting ? "Bidding…" : "Place bid"}
              </button>
            </div>
          ) : (
            <p style={{ color: "#666" }}>
              {state.myRole === "member" ? "Only your team leader can bid." : "You are not on a team in this event."}
            </p>
          )}
          {error && <p style={{ color: "crimson" }}>{error}</p>}
        </section>
      ) : (
        <p>No lot is live right now.</p>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h3>Your team</h3>
        <p>{myTeam ? `${myTeam.name}: ${myTeam.auctionTokens ?? "—"} tokens` : "Not on a team."}</p>
      </section>
    </main>
  );
}
