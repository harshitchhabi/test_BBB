"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, StatTile } from "@/components/theme/Panel";

// Section 7.7 Portfolio and final score screen. Before reveal: approved
// deeds + bonus points, pre-multiplier score, city name/tier without its
// number. After reveal: full breakdown, final score, rank + tiebreak.
export default function PortfolioPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [preReveal, setPreReveal] = useState<any>(null);
  const [standing, setStanding] = useState<any>(null);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const ov = await fetchJson<any>(`/api/events/${eventId}/overview`);
      setOverview(ov);
      if (!ov.myTeam) return;

      const [bld, scoreData] = await Promise.all([
        fetchJson<any>(`/api/events/${eventId}/buildings/list?teamId=${ov.myTeam.id}`),
        ov.event.status === "completed"
          ? fetchJson<any>(`/api/events/${eventId}/scoreboard`)
          : fetchJson<any>(`/api/events/${eventId}/teams/${ov.myTeam.id}/pre-reveal-score`),
      ]);
      setBuildings(bld.buildings);

      if (ov.event.status === "completed") {
        setStanding(scoreData.standings.find((s: any) => s.teamId === ov.myTeam.id) ?? null);
      } else {
        setPreReveal(scoreData);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof FetchJsonError ? err.message : "Couldn't load this page. Retrying…");
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  if (loadError && !overview) return <PageFrame><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  if (!overview.myTeam) {
    return (
      <PageFrame>
        <TeamNav eventId={eventId} />
        <p className="text-[#F1EBB5]">Join a team first.</p>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner image="/assets/images/cart_page/header.png">PORTFOLIO & SCORE</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}

      <Panel className="w-full max-w-2xl mb-6">
        <PanelTitle>APPROVED BUILDINGS</PanelTitle>
        <div className="space-y-1">
          {buildings.filter((b) => b.status === "approved").map((b) => (
            <div key={b.id} className="bg-[#764A21]/40 rounded px-3 py-2 text-white text-sm">
              {b.recipeName} — {b.basePoints} pts
              {b.ecoBonus ? ` +${b.ecoBonus} Eco` : ""}
              {b.luxuryBonus ? ` +${b.luxuryBonus} Luxury` : ""}
              {b.landmarkBonus ? ` +${b.landmarkBonus} Landmark` : ""}
            </div>
          ))}
        </div>
      </Panel>

      {standing ? (
        <Panel className="w-full max-w-2xl border-2 border-[#F1EBB5]/40">
          <h2 className="text-3xl text-[#FDE047] text-outline-black font-bold text-center mb-4">FINAL SCORE: {standing.finalScore}</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <StatTile label="Building" value={standing.buildingPoints} />
            <StatTile label="Bonus" value={standing.bonusPoints} />
            <StatTile label="Leftover" value={standing.leftoverPoints} />
          </div>
          <p className="text-center text-white mb-2">City multiplier: ×{standing.cityMultiplier}</p>
          <p className="text-center text-yellow-300 font-bold">Rank #{standing.rank} (placement #{standing.tiebreakerRank})</p>
          <details className="mt-3 text-white/80 text-sm">
            <summary className="cursor-pointer">Full calculation</summary>
            <pre className="whitespace-pre-wrap">{JSON.stringify(standing.calculationJson, null, 2)}</pre>
          </details>
        </Panel>
      ) : preReveal ? (
        <Panel className="w-full max-w-2xl">
          <h2 className="text-2xl text-[#FDE047] text-outline-black font-bold text-center mb-4">PRE-REVEAL SCORE: {preReveal.preMultiplierTotal}</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <StatTile label="Building" value={preReveal.buildingPoints} />
            <StatTile label="Bonus" value={preReveal.bonusPoints} />
            <StatTile label="Leftover" value={preReveal.leftoverPoints} />
          </div>
          {preReveal.city ? (
            <p className="text-center text-[#F1EBB5]">
              Your city: {preReveal.city.name} ({preReveal.city.tier}) — multiplier revealed once every city is sold.
            </p>
          ) : (
            <p className="text-center text-[#F1EBB5]">You haven't won a city yet.</p>
          )}
        </Panel>
      ) : null}
    </PageFrame>
  );
}
