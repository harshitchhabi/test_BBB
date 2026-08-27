"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import type { AuctionStateResponse } from "@/lib/auction-state-types";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, StatTile, WoodButton } from "@/components/theme/Panel";

// Section 7.3 Live Auction screen — restyled to match the legacy
// BidClient/BiddingInterface/Timer/BidHistory components exactly: the
// bid/header.png banner, the connection-status pill, the circular
// countdown ring, the hourglass "no active auction" state, and the gold
// bid-history cards. All members can watch; only the authenticated team
// leader can submit a bid (enforced server-side regardless of what this
// page shows).
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

  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
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
      if (!res.ok) setError(body.message ?? "Bid rejected.");
      else {
        setBidAmount("");
        refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  if (status === "unauthenticated") return <PageFrame><p className="text-[#F1EBB5]">Sign in to view the auction.</p></PageFrame>;
  if (!state) return <PageFrame><p className="text-[#F1EBB5]">Loading auction state…</p></PageFrame>;

  const myTeam = state.teams.find((t) => t.id === state.myTeamId);
  const canBid = state.myRole === "leader" && state.liveLot != null;
  const secondsLeft = state.liveLot?.closesAt ? Math.max(0, Math.round((new Date(state.liveLot.closesAt).getTime() - Date.now()) / 1000)) : 0;
  // The read model only exposes closesAt, not the lot's total configured
  // duration, so the ring approximates against a 60s reference rather
  // than showing a perfectly calibrated sweep — good enough for "time is
  // running low," which is the only thing this ring needs to communicate.
  const ringPct = Math.min(100, (secondsLeft / 60) * 100);
  const ringColor = secondsLeft <= 5 ? "text-red-500" : secondsLeft <= 10 ? "text-yellow-400" : "text-green-500";

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>🏗️ CONSTRUCTION BIDDING PLATFORM</HeaderBanner>

      <div className="flex justify-center mb-4">
        <div className={`flex items-center gap-2 px-3 py-1 border-2 rounded bg-[#978056]/37 ${connected ? "border-green-400" : "border-red-400"}`}>
          <div className={`w-3 h-3 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-[#F1EBB5] text-sm">{connected ? "CONNECTED" : "DISCONNECTED"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 w-full">
        <div className="xl:col-span-2 space-y-4">
          {state.activeRound && (
            <Panel>
              <p className="text-[#F1EBB5]">
                Round {state.activeRound.sequence}: <strong>{state.activeRound.materialName ?? state.activeRound.materialKey}</strong>
              </p>
              {state.activeRound.shock && (
                <p className="text-yellow-300 mt-1">
                  ⚡ {state.activeRound.shock.title} — {state.activeRound.shock.description}
                </p>
              )}
            </Panel>
          )}

          {state.liveLot ? (
            <Panel className="p-8">
              <h2 className="text-2xl font-semibold text-[#FDE047] text-outline-black tracking-wide mb-6">PLACE YOUR BID</h2>
              <p className="text-[#F1EBB5] mb-2">
                Lot #{state.liveLot.lotNumber} — {state.liveLot.materialName ?? state.liveLot.materialKey}
              </p>
              <div className="bg-white/20 border border-black rounded-lg p-4 mb-4">
                <p className="text-lg text-black font-bold">
                  {state.liveLot.currentHighestBid ? `₹${state.liveLot.currentHighestBid.amount}` : "No bids yet"}
                </p>
                <p className="text-black/70 text-sm">Opening bid: ₹{state.liveLot.openingBid} · Next minimum: ₹{state.liveLot.nextMinimumBid}</p>
              </div>

              {canBid ? (
                <div className="space-y-3">
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={String(state.liveLot.nextMinimumBid)}
                    className="w-full px-4 py-3 rounded-lg text-black text-xl font-semibold"
                  />
                  <WoodButton variant="primary" className="w-full text-lg py-3" onClick={submitBid} disabled={submitting || !bidAmount}>
                    {submitting ? "⏳ Placing Bid..." : "🚀 Place Bid"}
                  </WoodButton>
                </div>
              ) : (
                <p className="text-[#F1EBB5]">
                  {state.myRole === "member" ? "Only your team leader can bid." : "You are not on a team in this event."}
                </p>
              )}
              {error && <p className="text-red-300 mt-3">{error}</p>}
            </Panel>
          ) : (
            <Panel className="text-center py-12">
              <img src="/assets/images/bid/hourglass.png" className="h-40 w-40 mx-auto" alt="" />
              <h2 className="text-3xl font-semibold text-[#FDE047] mb-2 tracking-widest text-outline-black">NO ACTIVE AUCTION</h2>
              <p className="text-white">Wait for the moderator to start a new bidding session</p>
            </Panel>
          )}
        </div>

        <div className="xl:col-span-1 space-y-4">
          {state.liveLot?.closesAt && (
            <Panel>
              <div className="flex items-center justify-center gap-2 mb-2">
                <img src="/assets/images/bid/timer.png" className="w-6 h-6" alt="" />
                <h2 className="text-lg font-semibold text-[#FDE047] text-outline-black tracking-widest">TIME REMAINING</h2>
              </div>
              <div className="relative w-28 h-28 mx-auto">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" strokeWidth="8" fill="transparent" className="text-[#573C17]" stroke="currentColor" />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    strokeWidth="8"
                    fill="transparent"
                    stroke="currentColor"
                    strokeDasharray={`${2 * Math.PI * 45}`}
                    strokeDashoffset={`${2 * Math.PI * 45 * (1 - ringPct / 100)}`}
                    strokeLinecap="round"
                    className={ringColor}
                  />
                </svg>
                <div className={`absolute inset-0 flex items-center justify-center text-2xl font-bold ${ringColor}`}>
                  {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
                </div>
              </div>
            </Panel>
          )}

          <Panel>
            <h2 className="text-lg font-semibold text-[#FDE047] text-outline-black mb-3 text-center tracking-widest">YOUR TEAM</h2>
            {myTeam ? <StatTile label={myTeam.name} value={`${myTeam.auctionTokens ?? "—"} tokens`} /> : <p className="text-[#F1EBB5] text-center">Not on a team.</p>}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
