"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession, signOut } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, WoodButton } from "@/components/theme/Panel";

const STAGE_LABELS: Record<string, string> = {
  setup: "Setup",
  lobby: "Lobby",
  stage_1: "Stage 1 — Material Auction",
  stage_2: "Stage 2 — Trading & Construction",
  stage_3: "Stage 3 — City Auction",
  scoring: "Scoring",
  completed: "Completed",
  paused: "Paused",
};

// The "view desk" — a read-only screen for someone who is neither on a
// team nor staff. Shows current stage and whichever of the Stage 1
// material auction / Stage 3 city auction is currently live, each with
// only the current bid and the name of whichever team currently holds
// it. No team balances, inventory, or trade activity — see
// spectator-view/route.ts for exactly what this reads.
export default function SpectatePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [view, setView] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/spectator-view`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setView(body);
      setLoadError(null);
    } else {
      setLoadError(body?.message ?? `Couldn't load this event (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  if (loadError && !view) {
    return (
      <PageFrame>
        <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p>
      </PageFrame>
    );
  }
  if (status === "loading" || !view) {
    return (
      <PageFrame>
        <div className="animate-spin h-10 w-10 border-4 border-b-transparent rounded-full border-yellow-300 mt-20" />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="w-full flex justify-end mb-2">
        <WoodButton onClick={() => signOut()}>Sign out</WoodButton>
      </div>
      <HeaderBanner>{view.eventName}</HeaderBanner>

      <Panel className="mb-6 w-full max-w-lg text-center">
        <p className="text-white/70 text-sm mb-1">Current stage</p>
        <p className="text-2xl font-bold text-yellow-300">{STAGE_LABELS[view.eventStatus] ?? view.eventStatus}</p>
      </Panel>

      {view.liveLot && (
        <Panel className="mb-6 w-full max-w-lg text-center border-2 border-yellow-400">
          <p className="text-white/70 text-sm mb-1">Live material lot</p>
          <p className="text-xl font-bold">{view.liveLot.materialName}</p>
          <p className="text-3xl font-bold text-yellow-300 mt-2">{view.liveLot.currentBid} tokens</p>
          <p className="text-white/80 mt-1">
            {view.liveLot.leaderTeamName ? `Current leader: ${view.liveLot.leaderTeamName}` : "No bids yet"}
          </p>
        </Panel>
      )}

      {view.liveCityAuction && (
        <Panel className="mb-6 w-full max-w-lg text-center border-2 border-yellow-400">
          <p className="text-white/70 text-sm mb-1">Live city auction</p>
          <p className="text-xl font-bold">{view.liveCityAuction.cityName}</p>
          <p className="text-3xl font-bold text-yellow-300 mt-2">{view.liveCityAuction.currentBid} tokens</p>
          <p className="text-white/80 mt-1">
            {view.liveCityAuction.leaderTeamName ? `Current leader: ${view.liveCityAuction.leaderTeamName}` : "No bids yet"}
          </p>
        </Panel>
      )}

      {!view.liveLot && !view.liveCityAuction && (
        <Panel className="w-full max-w-lg text-center">
          <p className="text-white/70">No live auction right now.</p>
        </Panel>
      )}
    </PageFrame>
  );
}
