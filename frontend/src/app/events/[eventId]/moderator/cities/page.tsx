"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { fetchEventOverviewFresh } from "@/lib/use-event-overview";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";
import { ConfirmDialog, type ConfirmDialogState } from "@/components/theme/ConfirmDialog";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Same reasoning as the Stage 1 moderator console's timer: deciding
  // when to step in and close a city auction manually previously meant
  // tabbing over to the team-facing screen just to see the countdown.
  const anyLive = auctions.some((a) => a.status === "live" && a.closesAt);
  useEffect(() => {
    if (!anyLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyLive]);

  const refresh = useCallback(async () => {
    try {
      const [ov, c, a] = await Promise.all([
        fetchEventOverviewFresh(eventId) as Promise<any>,
        fetchJson<any>(`/api/events/${eventId}/cities`),
        fetchJson<any>(`/api/events/${eventId}/city-auctions/list`),
      ]);
      setOverview(ov);
      setCities(c.cities);
      setAuctions(a.auctions);
      if (ov.event?.status === "completed") {
        const s = await fetchJson<any>(`/api/events/${eventId}/exports/standings?format=json`);
        setStandings(s.standings ?? []);
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

  async function call(path: string, body?: unknown) {
    if (busy) return;
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

  if (loadError && !overview) return <PageFrame><ModNav eventId={eventId} /><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  function revealAndFinalize() {
    setConfirmState({
      title: "Reveal & finalize scores",
      message: "Reveal all city multipliers and finalize scores? This is irreversible for this round - every team's final rank locks in.",
      confirmLabel: "Reveal & finalize",
      danger: true,
      onConfirm: () => call(`/api/events/${eventId}/cities/reveal`),
    });
  }

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
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      <WoodButton variant="danger" disabled={busy} onClick={revealAndFinalize} className="mb-4 text-lg">
        Reveal all multipliers & finalize scores
      </WoodButton>

      {standings && standings.length > 0 && (
        <Panel className="w-full mb-4 border-2 border-yellow-400">
          <PanelTitle>FINAL RESULTS</PanelTitle>
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
                  {c.name} ({c.tier}) - {c.assignedTeamId ? `sold to ${overview.teams.find((t: any) => t.id === c.assignedTeamId)?.name}` : live ? "live" : "unsold"}
                  {live?.closesAt && (() => {
                    const secondsLeft = Math.max(0, Math.round((new Date(live.closesAt).getTime() - now) / 1000));
                    return (
                      <span className={`ml-2 font-bold ${secondsLeft <= 10 ? "text-red-400" : "text-yellow-300"}`}>
                        ({Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")})
                      </span>
                    );
                  })()}
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
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </PageFrame>
  );
}
