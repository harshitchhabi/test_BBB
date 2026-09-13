"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle } from "@/components/theme/Panel";

// Section 7.9 "Score & Reveal" / Exports, combined: the final results
// belong on screen, front and center, not hidden behind a CSV download —
// this is the moment of the whole event, someone should be able to just
// look at it. The CSV exports stay, but as a secondary "keep a backup
// copy" section underneath, not the primary way to see who won.
export default function ModeratorExportsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [standings, setStandings] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/exports/standings?format=json`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setStandings(body.standings);
      setLoadError(null);
    } else {
      setLoadError(body?.message ?? `Couldn't load standings (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>FINAL RESULTS</HeaderBanner>

      <Panel className="w-full mb-4">
        <PanelTitle>STANDINGS</PanelTitle>
        {loadError && <p className="text-red-300">{loadError}</p>}
        {!loadError && !standings && <p className="text-white/70">Loading…</p>}
        {!loadError && standings && standings.length === 0 && (
          <p className="text-white/70">No final scores yet — reveal cities on the Stage 3 Cities screen first.</p>
        )}
        {standings && standings.length > 0 && (
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
        )}
      </Panel>

      <Panel className="w-full max-w-lg">
        <PanelTitle>BACKUP EXPORTS (CSV)</PanelTitle>
        <ul className="space-y-2 text-yellow-200 underline text-sm">
          <li><a href={`/api/events/${eventId}/exports/standings`}>Final standings</a></li>
          <li><a href={`/api/events/${eventId}/exports/audit-log`}>Audit log</a></li>
          <li><a href={`/api/events/${eventId}/exports/inventory`}>Team inventory ledger</a></li>
          <li><a href={`/api/events/${eventId}/exports/bid-history`}>Stage 1 bid history</a></li>
        </ul>
      </Panel>
    </PageFrame>
  );
}
