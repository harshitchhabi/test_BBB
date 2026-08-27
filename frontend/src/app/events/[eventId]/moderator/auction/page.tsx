"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import type { AuctionStateResponse } from "@/lib/auction-state-types";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.8/7.9 moderator console — Stage 1 Auction Control slice.
// Every button here calls the same command endpoints a script or a
// future automated test would; this page has no authority of its own —
// the server re-checks staff status on every request.
export default function ModeratorAuctionPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [state, setState] = useState<AuctionStateResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [materialTypeId, setMaterialTypeId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      else await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status !== "authenticated") return <PageFrame><p className="text-[#F1EBB5]">Sign in as a moderator.</p></PageFrame>;
  if (loadError) return <PageFrame><ModNav eventId={eventId} /><p className="text-red-300 text-center mt-8">{loadError}</p></PageFrame>;
  if (!state) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  if (!state.isStaff) return <PageFrame><ModNav eventId={eventId} /><p className="text-[#F1EBB5]">You are not staff for this event.</p></PageFrame>;

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>STAGE 1 AUCTION CONTROL</HeaderBanner>
      {message && <p className="text-red-300 mb-3">{message}</p>}

      <Panel className="w-full max-w-2xl mb-4">
        <PanelTitle>START A ROUND</PanelTitle>
        <p className="text-white/70 text-sm mb-2">Enter the material type ID to auction next.</p>
        <div className="flex gap-2">
          <input value={materialTypeId} onChange={(e) => setMaterialTypeId(e.target.value)} placeholder="material type id" className="flex-1 px-3 py-2 rounded text-black" />
          <WoodButton variant="primary" disabled={busy || !materialTypeId} onClick={() => call(`/api/events/${eventId}/auction-rounds`, { materialTypeId })}>
            Start round
          </WoodButton>
        </div>
      </Panel>

      {state.activeRound && (
        <Panel className="w-full max-w-2xl mb-4">
          <PanelTitle>
            ROUND {state.activeRound.sequence}: {state.activeRound.materialName ?? state.activeRound.materialKey}
          </PanelTitle>
          {state.activeRound.shock && (
            <p className="text-yellow-300 mb-2">⚡ {state.activeRound.shock.title} — {state.activeRound.shock.description}</p>
          )}
          <p className="text-white mb-3">{state.pendingLotsCount} lot(s) still pending in this round.</p>

          {state.liveLot ? (
            <div className="bg-[#764A21]/40 rounded-lg p-3">
              <p className="text-white">
                Live: lot #{state.liveLot.lotNumber} — opening {state.liveLot.openingBid}, next min {state.liveLot.nextMinimumBid}
              </p>
              <p className="text-white/70 text-sm mb-2">Current highest: {state.liveLot.currentHighestBid ? state.liveLot.currentHighestBid.amount : "none"}</p>
              <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/auction-lots/${state.liveLot!.id}/close`, { reason: "Moderator closed the lot." })}>
                Close lot
              </WoodButton>
            </div>
          ) : (
            <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/auction-rounds/${state.activeRound!.id}/open-next-lot`)}>
              Open next lot
            </WoodButton>
          )}
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
    </PageFrame>
  );
}
