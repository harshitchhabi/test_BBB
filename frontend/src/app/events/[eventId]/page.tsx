"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import Link from "next/link";
import { TeamNav } from "./team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, StatTile, WoodButton } from "@/components/theme/Panel";

// Section 7.2 Team home / event lobby — restyled with the legacy team
// page's exact visual language: the team/header-bg.png banner and the
// wooden hanging-sign panel from AfterTeamView.
//
// Task 1: a team's login is admin-issued and already attached to its
// team the moment it's created — there's no more "sign in, then create
// your team" step, so this screen no longer has a Create Team form, and
// no "Leave team" button either (a shared team login has nowhere to
// leave to: it IS the team, not a person who joined one).
export default function EventHomePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/overview`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setOverview(body);
      setLoadError(null);
    } else {
      setLoadError(body?.message ?? `Couldn't load this event (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  if (loadError) {
    return (
      <PageFrame>
        <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p>
      </PageFrame>
    );
  }
  if (status === "loading" || !overview) {
    return (
      <PageFrame>
        <div className="animate-spin h-10 w-10 border-4 border-b-transparent rounded-full border-yellow-300 mt-20" />
      </PageFrame>
    );
  }

  const stageOrder = ["setup", "lobby", "stage_1", "stage_2", "stage_3", "scoring", "completed"];
  const stageLabels: Record<string, string> = {
    setup: "Setup",
    lobby: "Lobby",
    stage_1: "Stage 1",
    stage_2: "Stage 2",
    stage_3: "Stage 3",
    scoring: "Scoring",
    completed: "Completed",
  };
  const currentIndex = stageOrder.indexOf(overview.event.status);

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner image="/assets/images/team/header-bg.png">{overview.event.name}</HeaderBanner>

      {overview.isStaff && (
        <Panel className="mb-6 border-2 border-yellow-400 w-full max-w-md text-center">
          <p className="text-yellow-300 mb-2">You are staff for this event.</p>
          <Link href={`/events/${eventId}/moderator/setup`}>
            <WoodButton variant="primary">Open Moderator Console →</WoodButton>
          </Link>
        </Panel>
      )}

      <Panel className="mb-6">
        <div className="flex flex-wrap gap-2 justify-center items-center text-[#F1EBB5] text-sm md:text-base">
          {stageOrder.map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              <span
                className={
                  i === currentIndex
                    ? "px-2 py-1 rounded bg-yellow-500 text-black font-bold"
                    : i < currentIndex
                      ? "font-bold"
                      : "opacity-40"
                }
              >
                {stageLabels[s] ?? s}
              </span>
              {i < stageOrder.length - 1 && <span className="opacity-60">→</span>}
            </span>
          ))}
        </div>
      </Panel>

      {!overview.isStaff && overview.myTeam && (
        <div className="flex flex-col items-center space-y-6 text-center bg-[#5e3c1c] p-6 rounded-xl border-4 border-[#3b2a1a] shadow-lg w-full max-w-md">
          <div className="bg-[#3b2a1a] text-white px-6 py-4 rounded shadow-inner border-4 border-[#a58d6f] relative w-full">
            <h2 className="text-2xl font-bold">TEAM {overview.myTeam.name?.toUpperCase()}</h2>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <StatTile label="Stage 1" value={overview.myTeam.auctionTokens} />
              <StatTile label="City Wallet" value={overview.myTeam.cityWalletTokens} />
              <StatTile label="Trades used" value={overview.myTeam.tradeCount} />
            </div>
          </div>

          {(overview.event.status === "setup" || overview.event.status === "lobby") && (
            <p className="text-[#F1EBB5]">Waiting for the moderator to start Stage 1…</p>
          )}
        </div>
      )}
    </PageFrame>
  );
}
