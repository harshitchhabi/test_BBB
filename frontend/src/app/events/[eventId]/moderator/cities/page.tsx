"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

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
  const [standings, setStandings] = useState<any[] | null>(null);

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
    const c = await fetch(`/api/events/${eventId}/cities`).then((r) => r.json());
    setCities(c.cities);
    const a = await fetch(`/api/events/${eventId}/city-auctions/list`).then((r) => r.json());
    setAuctions(a.auctions);
    if (ov.event?.status === "completed") {
      const s = await fetch(`/api/events/${eventId}/exports/standings?format=json`).then((r) => r.json());
      setStandings(s.standings ?? []);
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
      else refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  const liveAuctionByCity = new Map(auctions.filter((a) => a.status === "live").map((a) => [a.cityId, a]));
  // Only active teams count toward "is exactly one team left without a
  // city" — a withdrawn/disqualified team that never won one would
  // otherwise permanently inflate this count and hide the "assign last
  // city" button even when the remaining active teams have genuinely
  // reached that point (scoring-service.ts's revealCitiesAndScore applies
  // this same active-only filter when it checks the same condition).
  const teamsWithoutCity = overview.teams.filter((t: any) => t.status === "active" && !cities.some((c: any) => c.assignedTeamId === t.id));

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>STAGE 3: CITIES & REVEAL</HeaderBanner>
      {message && <p className="text-red-300 mb-3">{message}</p>}

      <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/cities/reveal`)} className="mb-4 text-lg">
        Reveal all multipliers & finalize scores
      </WoodButton>

      {standings && standings.length > 0 && (
        <Panel className="w-full mb-4 border-2 border-yellow-400">
          <PanelTitle>🏆 FINAL RESULTS</PanelTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-white text-sm md:text-base">
              <thead>
                <tr className="text-yellow-300 text-left">
                  <th className="pr-4 py-1">Place</th>
                  <th className="pr-4 py-1">Team</th>
                  <th className="pr-4 py-1 text-right">Building</th>
                  <th className="pr-4 py-1 text-right">Bonus</th>
                  <th className="pr-4 py-1 text-right">Leftover</th>
                  <th className="pr-4 py-1 text-right">City ×</th>
                  <th className="pr-4 py-1 text-right">Final score</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s: any) => (
                  <tr key={s.place} className="odd:bg-[#764A21]/30">
                    <td className="pr-4 py-1 font-bold">#{s.place}</td>
                    <td className="pr-4 py-1">{s.team}</td>
                    <td className="pr-4 py-1 text-right">{s.buildingPoints}</td>
                    <td className="pr-4 py-1 text-right">{s.bonusPoints}</td>
                    <td className="pr-4 py-1 text-right">{s.leftoverPoints}</td>
                    <td className="pr-4 py-1 text-right">×{s.cityMultiplier}</td>
                    <td className="pr-4 py-1 text-right font-bold text-yellow-300">{s.finalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel className="w-full">
        <div className="space-y-2">
          {cities.map((c) => {
            const live = liveAuctionByCity.get(c.id);
            return (
              <div key={c.id} className="bg-[#764A21]/40 rounded-lg p-3 flex justify-between items-center text-white flex-wrap gap-2">
                <span>
                  {c.name} ({c.tier}) — {c.assignedTeamId ? `sold to ${overview.teams.find((t: any) => t.id === c.assignedTeamId)?.name}` : live ? "live" : "unsold"}
                </span>
                <div className="flex gap-2">
                  {!c.assignedTeamId && !live && (
                    <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/cities/${c.id}/start-auction`)}>Start auction</WoodButton>
                  )}
                  {live && (
                    <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/city-auctions/${live.id}/close`)}>Close</WoodButton>
                  )}
                  {!c.assignedTeamId && !live && teamsWithoutCity.length === 1 && (
                    <WoodButton disabled={busy} onClick={() => call(`/api/events/${eventId}/cities/${c.id}/assign-last`, { teamId: teamsWithoutCity[0].id })}>
                      Assign to {teamsWithoutCity[0].name} (last team)
                    </WoodButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </PageFrame>
  );
}
