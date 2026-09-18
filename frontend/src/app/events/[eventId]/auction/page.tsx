"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/use-session";
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
  const [inventory, setInventory] = useState<Array<{ materialTypeId: string; materialName: string; quantity: number }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // secondsLeft below is derived from `closesAt` and `now` — without this
  // tick, the displayed countdown only changed when a WebSocket broadcast
  // happened to trigger a re-render (someone else bidding), so a team just
  // watching the clock during a quiet moment would see it appear frozen
  // instead of visibly counting down, which defeats the point of a timed
  // auction. A 1-lot-at-a-time countdown for ~30 teams is cheap enough to
  // just tick every second while a lot is live.
  useEffect(() => {
    if (!state?.liveLot) return;
    // Fires immediately, not just on the first 1s tick — without this, a
    // new lot going live showed a stale countdown (computed against
    // whatever `now` happened to be from before this lot existed) for up
    // to a full second before the interval's first callback corrected
    // it, which read as the timer visibly lagging when it started.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.liveLot?.id, state?.liveLot?.closesAt]);

  // Section 7.3: bidding is stepper-only, not free typing — a team can
  // only ever land on a value the server would actually accept (the
  // current minimum, or that plus whole minimumRaise increments), so
  // there's no way to fat-finger a bid that's rejected as "too low" or
  // one far above what was intended.
  //
  // Two different reasons to reset, handled separately: a brand NEW lot
  // (lotId changed) always resets to its own fresh minimum, even if
  // that's LOWER than whatever this team had stepped to on the previous
  // lot — a bug fixed here, since the old version only clamped upward
  // and left the stepper stuck showing the previous lot's higher amount.
  // Within the SAME lot, it only clamps up when someone else's bid moves
  // nextMinimumBid past whatever this team had stepped to.
  const liveLotIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state?.liveLot) {
      liveLotIdRef.current = null;
      return;
    }
    const isNewLot = liveLotIdRef.current !== state.liveLot.id;
    liveLotIdRef.current = state.liveLot.id;
    setBidAmount((prev) => {
      const prevNum = Number(prev);
      if (isNewLot || !prev || !Number.isFinite(prevNum) || prevNum < state.liveLot!.nextMinimumBid) {
        return String(state.liveLot!.nextMinimumBid);
      }
      return prev;
    });
  }, [state?.liveLot?.id, state?.liveLot?.nextMinimumBid]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/auction-state`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setState(body);
      setLoadError(null);
      // Section 7.3: a team deciding how much more to bid on a material
      // needs to see how much of it they already hold, not just their
      // token balance — previously this screen only showed tokens.
      if (body.myTeamId) {
        fetch(`/api/events/${eventId}/teams/${body.myTeamId}/inventory`)
          .then((r) => r.json())
          .then((d) => setInventory(d.inventory ?? []))
          .catch(() => {});
      }
    } else {
      // Previously this just silently did nothing on a non-200 — e.g. a
      // 403 for someone who hasn't joined a team yet left the screen
      // stuck on "Loading auction state…" forever with no explanation.
      setLoadError(body?.message ?? `Couldn't load the auction (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  // A ref, not the submitting state: React's re-render (what actually
  // disables the Place Bid button on screen) happens asynchronously
  // relative to the click event, so two clicks close enough together
  // could both reach this function while `submitting` still reads
  // false in both closures. This function previously had NO internal
  // guard at all (only the button's disabled prop), so this closes a
  // real gap, not just a timing nuance - though note bidding itself was
  // already safe from actual harm either way: placeBid locks the lot
  // row and only ever deducts tokens at close time, so a redundant
  // second bid is just cleanly rejected, never a double-charge.
  const [reservedKitBusy, setReservedKitBusy] = useState(false);
  const [reservedKitMessage, setReservedKitMessage] = useState<string | null>(null);
  const reservedKitBusyRef = useRef(false);
  async function claimReservedKit() {
    if (!state?.myTeamId || !state.activeRound || reservedKitBusyRef.current) return;
    reservedKitBusyRef.current = true;
    setReservedKitBusy(true);
    setReservedKitMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/reserved-kit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: state.myTeamId, materialTypeId: state.activeRound.materialTypeId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setReservedKitMessage(body.message ?? `Couldn't claim it (${res.status}).`);
      else setReservedKitMessage(`Claimed ${body.quantity} ${state.activeRound.materialName ?? "units"} for ${body.amount} tokens.`);
      await refresh();
    } finally {
      reservedKitBusyRef.current = false;
      setReservedKitBusy(false);
    }
  }

  const submittingRef = useRef(false);
  async function submitBid() {
    if (!state?.liveLot || !state.myTeamId || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/auction-lots/${state.liveLot.id}/bids`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: state.myTeamId, amount: Number(bidAmount) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.message ?? `Bid rejected (${res.status}).`);
      else setBidAmount("");
      // Refresh either way: a rejected bid can mean the lot closed or a
      // new one opened in the moment between render and click - reload
      // the real state so this screen doesn't keep showing a dead lot.
      await refresh();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (status === "loading") return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  if (status === "unauthenticated") return <PageFrame><p className="text-[#F1EBB5]">Sign in to view the auction.</p></PageFrame>;
  if (loadError) {
    return (
      <PageFrame>
        <TeamNav eventId={eventId} />
        <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p>
      </PageFrame>
    );
  }
  if (!state) return <PageFrame><p className="text-[#F1EBB5]">Loading auction state…</p></PageFrame>;

  const myTeam = state.teams.find((t) => t.id === state.myTeamId);
  const secondsLeft = state.liveLot?.closesAt ? Math.max(0, Math.round((new Date(state.liveLot.closesAt).getTime() - now) / 1000)) : 0;
  // secondsLeft > 0 is required too: the countdown is purely a client-side
  // clock reading (see closesAt above), and a bid submitted after it hits
  // 0:00 will always be rejected server-side (the timer sweep or the
  // moderator's "Close lot" already ended it) — better to disable the
  // button the moment the clock a team is staring at says "time's up"
  // than let them submit into a guaranteed, confusing rejection.
  const canBid = state.myRole === "leader" && state.liveLot != null && secondsLeft > 0;
  // The read model only exposes closesAt, not the lot's total configured
  // duration, so the ring approximates against a 60s reference rather
  // than showing a perfectly calibrated sweep — good enough for "time is
  // running low," which is the only thing this ring needs to communicate.
  const ringPct = Math.min(100, (secondsLeft / 60) * 100);
  const ringColor = secondsLeft <= 5 ? "text-red-500" : secondsLeft <= 10 ? "text-yellow-400" : "text-green-500";

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>CONSTRUCTION BIDDING PLATFORM</HeaderBanner>

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
                  {state.activeRound.shock.title} - {state.activeRound.shock.description}
                </p>
              )}
              {state.activeRound.reservedKitEligible && state.activeRound.reservedKitWindowOpen && (
                <div className="mt-3 bg-black/30 rounded p-3">
                  <p className="text-yellow-300 text-sm mb-2">
                    Reserved Kit: claim one lot of {state.activeRound.materialName} at its printed opening price, no bidding — only
                    available until the first lot goes up for open bidding.
                  </p>
                  {state.myRole === "leader" ? (
                    <WoodButton variant="primary" disabled={reservedKitBusy} onClick={claimReservedKit}>
                      {reservedKitBusy ? "Claiming…" : "Claim Reserved Kit"}
                    </WoodButton>
                  ) : (
                    <p className="text-[#F1EBB5] text-sm">Only your team leader can claim it.</p>
                  )}
                  {reservedKitMessage && <p className="text-yellow-100 text-sm mt-2">{reservedKitMessage}</p>}
                </div>
              )}
            </Panel>
          )}

          {state.liveLot ? (
            <Panel className="p-8">
              <h2 className="text-2xl font-semibold text-[#FDE047] text-outline-black tracking-wide mb-6">PLACE YOUR BID</h2>
              <p className="text-[#F1EBB5] mb-2">
                Lot #{state.liveLot.lotNumber} - {state.liveLot.materialName ?? state.liveLot.materialKey}
                {state.liveLot.quantity != null && <span className="text-yellow-300"> ({state.liveLot.quantity} units in this lot)</span>}
                {(() => {
                  const held = inventory.find((i: any) => i.materialKey === state.liveLot!.materialKey)?.quantity ?? 0;
                  return held > 0 ? <span className="text-yellow-300"> - you already hold {held}</span> : null;
                })()}
              </p>
              <div className="bg-white/20 border border-black rounded-lg p-4 mb-4">
                <p className="text-lg text-black font-bold">
                  {state.liveLot.currentHighestBid ? `₹${state.liveLot.currentHighestBid.amount}` : "No bids yet"}
                </p>
                {state.liveLot.currentHighestBid && (
                  <p className="text-black/80 text-sm font-semibold">
                    Currently winning: {state.teams.find((t) => t.id === state.liveLot!.currentHighestBid!.teamId)?.name ?? "Unknown team"}
                    {state.liveLot.currentHighestBid.teamId === state.myTeamId ? " (you)" : ""}
                  </p>
                )}
                <p className="text-black/70 text-sm">Opening bid: ₹{state.liveLot.openingBid} · Next minimum: ₹{state.liveLot.nextMinimumBid}</p>
              </div>

              {canBid ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <WoodButton
                      type="button"
                      className="text-2xl px-4 py-3"
                      disabled={submitting || Number(bidAmount) <= state.liveLot.nextMinimumBid}
                      onClick={() => setBidAmount((v) => String(Math.max(state.liveLot!.nextMinimumBid, Number(v) - state.liveLot!.minimumRaise)))}
                    >
                      −
                    </WoodButton>
                    <div className="flex-1 text-center px-4 py-3 rounded-lg bg-white/90 text-black text-2xl font-bold">
                      ₹{bidAmount || state.liveLot.nextMinimumBid}
                    </div>
                    <WoodButton
                      type="button"
                      className="text-2xl px-4 py-3"
                      disabled={submitting}
                      onClick={() => setBidAmount((v) => String((Number(v) || state.liveLot!.nextMinimumBid) + state.liveLot!.minimumRaise))}
                    >
                      +
                    </WoodButton>
                  </div>
                  <p className="text-[#F1EBB5]/70 text-xs text-center">
                    Each press moves by the minimum raise (₹{state.liveLot.minimumRaise}) - always a bid the auction will actually accept.
                  </p>
                  <WoodButton variant="primary" className="w-full text-lg py-3" onClick={submitBid} disabled={submitting || !bidAmount}>
                    {submitting ? "Placing Bid..." : "Place Bid"}
                  </WoodButton>
                </div>
              ) : (
                <p className="text-[#F1EBB5]">
                  {state.myRole === "member"
                    ? "Only your team leader can bid."
                    : state.myRole !== "leader"
                      ? "You are not on a team in this event."
                      : "This lot's timer has run out - waiting for the moderator to close it."}
                </p>
              )}
              {error && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mt-3">{error}</p>}
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
            {myTeam ? <StatTile label={myTeam.name} value={`${myTeam.auctionTokens ?? "-"} tokens`} /> : <p className="text-[#F1EBB5] text-center">Not on a team.</p>}
          </Panel>

          {myTeam && inventory.length > 0 && (
            <Panel>
              <h2 className="text-lg font-semibold text-[#FDE047] text-outline-black mb-3 text-center tracking-widest">YOUR MATERIALS</h2>
              <div className="space-y-1">
                {inventory.filter((i) => i.quantity !== 0).map((i) => (
                  <div key={i.materialTypeId} className="flex justify-between text-sm bg-[#764A21]/40 rounded px-2 py-1">
                    <span className="text-yellow-200">{i.materialName}</span>
                    <span className="text-white font-bold">{i.quantity}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
