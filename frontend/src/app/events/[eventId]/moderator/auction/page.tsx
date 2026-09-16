"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import type { AuctionStateResponse } from "@/lib/auction-state-types";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";
import { ConfirmDialog, type ConfirmDialogState } from "@/components/theme/ConfirmDialog";

// Section 7.8/7.9 moderator console — Stage 1 Auction Control slice.
// Every button here calls the same command endpoints a script or a
// future automated test would; this page has no authority of its own —
// the server re-checks staff status on every request.
export default function ModeratorAuctionPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [state, setState] = useState<AuctionStateResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<
    Array<{ materialTypeId: string; materialName: string; defaultLotQuantity?: number; defaultOpeningBid?: number }>
  >([]);
  const [materialTypeId, setMaterialTypeId] = useState("");
  const [lotQuantity, setLotQuantity] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The moderator console only ever showed the timer indirectly (via the
  // team-facing screen), which meant deciding when to step in and close
  // a lot manually required tabbing over to check. Same 1-second tick as
  // the Live Auction screen's countdown.
  useEffect(() => {
    if (!state?.liveLot?.closesAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.liveLot?.id, state?.liveLot?.closesAt]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/auction-state`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setState(body);
      setLoadError(null);
    } else {
      setLoadError(body?.message ?? `Couldn't load the auction (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") {
      refresh();
      // bank-stock lists every material regardless of stage/stock level
      // (a left join that still returns every material_types row) — it's
      // the cheapest existing endpoint that already has {materialTypeId,
      // materialName}, so it doubles as the round picker's material list
      // instead of asking the moderator to paste in a raw UUID.
      fetch(`/api/events/${eventId}/bank-stock`)
        .then((r) => r.json())
        .then((d) => setMaterials(d.stock ?? []))
        .catch(() => {});
    }
  }, [status, eventId, refresh]);

  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  async function call(path: string, body?: unknown, onSuccess?: () => void) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(json.message ?? `Error (${res.status})`);
      else {
        onSuccess?.();
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  // Task 2: dream_team's admin console can force a lot's outcome after
  // the fact. Two tools, for two different moments:
  // - voidBid, while a lot is still LIVE: strikes a fraudulent/duplicate
  //   bid before it settles anything, letting the previous bid regain
  //   "winning." Safe because nothing has been paid out yet.
  // - reopenLot, on an already-closed lot: properly reverses the sale
  //   (refunds tokens, reverses the material grant) before putting it
  //   back up live — the only safe way to undo a lot that already
  //   settled, since a bare voidBid there would leave the winner's
  //   tokens/materials changed but the bid marked voided, an
  //   inconsistent state.
  function voidCurrentHighestBid(bidId: string, lotNumber: number) {
    setConfirmState({
      title: "Void current highest bid",
      message: `Void the current highest bid on lot #${lotNumber}? The next-highest bid (if any) becomes winning.`,
      confirmLabel: "Void bid",
      danger: true,
      onConfirm: (reason) => call(`/api/events/${eventId}/bids/${bidId}/void`, { reason }),
    });
  }

  function reopenLot(lotId: string, lotNumber: number) {
    setConfirmState({
      title: "Reopen lot",
      message: `Reopen lot #${lotNumber} for more bidding? This properly reverses the sale (refunds the winner's tokens, reverses the material grant) before putting it back up live.`,
      confirmLabel: "Reopen",
      danger: true,
      onConfirm: (reason) => call(`/api/events/${eventId}/auction-lots/${lotId}/reopen`, { reason }),
    });
  }

  if (status !== "authenticated") return <PageFrame><p className="text-[#F1EBB5]">Sign in as a moderator.</p></PageFrame>;
  if (loadError) return <PageFrame><ModNav eventId={eventId} /><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!state) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  if (!state.isStaff) return <PageFrame><ModNav eventId={eventId} /><p className="text-[#F1EBB5]">You are not staff for this event.</p></PageFrame>;

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>STAGE 1 AUCTION CONTROL</HeaderBanner>
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      <Panel className="w-full max-w-2xl mb-4">
        <PanelTitle>START A ROUND</PanelTitle>
        <p className="text-white/70 text-sm mb-2">Pick the next material to auction.</p>
        <div className="flex gap-2 flex-wrap">
          <select value={materialTypeId} onChange={(e) => setMaterialTypeId(e.target.value)} className="flex-1 min-w-40 px-3 py-2 rounded text-black">
            <option value="">Choose a material…</option>
            {materials.map((m: any) => (
              <option key={m.materialTypeId} value={m.materialTypeId}>
                {m.materialName}
                {m.defaultLotQuantity != null ? ` (default ${m.defaultLotQuantity}/lot, opens at ${m.defaultOpeningBid})` : ""}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={lotQuantity}
            onChange={(e) => setLotQuantity(e.target.value)}
            placeholder={
              materialTypeId
                ? `Qty per lot (default ${materials.find((m: any) => m.materialTypeId === materialTypeId)?.defaultLotQuantity ?? "?"})`
                : "Qty per lot (default)"
            }
            className="w-56 px-3 py-2 rounded text-black"
          />
          <WoodButton
            variant="primary"
            disabled={busy || !materialTypeId}
            onClick={() =>
              call(
                `/api/events/${eventId}/auction-rounds`,
                { materialTypeId, lotQuantityOverride: lotQuantity ? Number(lotQuantity) : undefined },
                () => {
                  setMaterialTypeId("");
                  setLotQuantity("");
                },
              )
            }
          >
            Start round
          </WoodButton>
        </div>
        <p className="text-white/50 text-xs mt-1">
          Leave quantity blank to use the material's configured default - every lot in this round (one per active
          team) will contain this much of the material.
        </p>
        {materials.length === 0 && <p className="text-yellow-300 text-sm mt-2">No materials found - has the event been seeded?</p>}
      </Panel>

      {state.activeRound && (
        <Panel className="w-full max-w-2xl mb-4">
          <PanelTitle>
            ROUND {state.activeRound.sequence}: {state.activeRound.materialName ?? state.activeRound.materialKey}
          </PanelTitle>
          {state.activeRound.shock && (
            <p className="text-yellow-300 mb-2">{state.activeRound.shock.title} - {state.activeRound.shock.description}</p>
          )}
          <p className="text-white mb-3">{state.pendingLotsCount} lot(s) still pending in this round.</p>

          {state.liveLot ? (
            <div className="bg-[#764A21]/40 rounded-lg p-3">
              <p className="text-white">
                Live: lot #{state.liveLot.lotNumber} - opening {state.liveLot.openingBid}, next min {state.liveLot.nextMinimumBid}
                {state.liveLot.quantity != null && ` - ${state.liveLot.quantity} units`}
              </p>
              <p className="text-white/70 text-sm mb-2">
                Current highest: {state.liveLot.currentHighestBid
                  ? `${state.liveLot.currentHighestBid.amount} (${state.teams.find((t) => t.id === state.liveLot!.currentHighestBid!.teamId)?.name ?? "unknown team"})`
                  : "none"}
              </p>
              {state.liveLot.closesAt && (() => {
                const secondsLeft = Math.max(0, Math.round((new Date(state.liveLot!.closesAt!).getTime() - now) / 1000));
                const urgent = secondsLeft <= 10;
                return (
                  <p className={`text-sm font-bold mb-2 ${urgent ? "text-red-400" : "text-yellow-300"}`}>
                    Time remaining: {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
                    {secondsLeft === 0 && " - timer's up, waiting to close"}
                  </p>
                );
              })()}
              <div className="flex gap-2 flex-wrap">
                <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/auction-lots/${state.liveLot!.id}/close`, { reason: "Moderator closed the lot." })}>
                  Close lot
                </WoodButton>
                {state.liveLot.currentHighestBid && (
                  <WoodButton disabled={busy} onClick={() => voidCurrentHighestBid(state.liveLot!.currentHighestBid!.id, state.liveLot!.lotNumber)}>
                    Void current highest bid
                  </WoodButton>
                )}
              </div>
            </div>
          ) : (
            <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/auction-rounds/${state.activeRound!.id}/open-next-lot`)}>
              Open next lot
            </WoodButton>
          )}
        </Panel>
      )}

      {state.recentLots.length > 0 && (
        <Panel className="w-full max-w-2xl mb-4">
          <PanelTitle>RECENT LOTS</PanelTitle>
          <p className="text-white/70 text-sm mb-2">
            Something went wrong with one of these? Reopen it - this properly reverses the sale (refunds the
            winner's tokens, reverses the material grant) and puts it back up live. Close it again with no new
            bids to force it unsold instead.
          </p>
          <div className="space-y-2">
            {state.recentLots.map((l) => (
              <div key={l.id} className="bg-[#764A21]/40 rounded-lg p-3 flex justify-between items-center text-white text-sm flex-wrap gap-2">
                <span>
                  Lot #{l.lotNumber} - {l.status}{l.winnerTeamName ? ` (won by ${l.winnerTeamName})` : ""}
                </span>
                <WoodButton disabled={busy} onClick={() => reopenLot(l.id, l.lotNumber)}>
                  Reopen
                </WoodButton>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="w-full max-w-2xl">
        <PanelTitle>TEAMS</PanelTitle>
        <div className="space-y-1">
          {state.teams.map((t) => (
            <div key={t.id} className="bg-[#764A21]/40 rounded px-3 py-2 flex justify-between text-white text-sm">
              <span>{t.name}</span>
              <span>{t.auctionTokens} tokens ({t.status})</span>
            </div>
          ))}
        </div>
      </Panel>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </PageFrame>
  );
}
