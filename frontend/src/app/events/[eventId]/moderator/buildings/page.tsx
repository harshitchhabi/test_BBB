"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.9 Build desk controls: verify recipe, void deed, resolve
// inspection.
export default function ModeratorBuildingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [buildings, setBuildings] = useState<any[] | null>(null);
  const [inspections, setInspections] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [b, i] = await Promise.all([
        fetchJson<any>(`/api/events/${eventId}/buildings/list`),
        fetchJson<any>(`/api/events/${eventId}/inspections/list`),
      ]);
      setBuildings(b.buildings);
      setInspections(i.inspections);
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

  if (loadError && buildings === null) return <PageFrame><ModNav eventId={eventId} /><p className="text-red-300 text-center mt-8">{loadError}</p></PageFrame>;
  if (buildings === null) return <PageFrame><ModNav eventId={eventId} /><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>BUILD / DEED DESK</HeaderBanner>
      {loadError && <p className="text-red-300 mb-3">{loadError}</p>}
      {message && <p className="text-red-300 mb-3">{message}</p>}

      <Panel className="w-full mb-4">
        <PanelTitle>CONSTRUCTED BUILDINGS</PanelTitle>
        {buildings.length === 0 && <p className="text-white/70 text-center py-4">No buildings constructed yet.</p>}
        <div className="space-y-2">
          {buildings.map((b) => (
            <div key={b.id} className="bg-[#764A21]/40 rounded-lg p-3 flex justify-between items-center text-white">
              <span>{b.deedNumber} — {b.teamName} — {b.recipeName}</span>
              <span>{b.basePoints + b.ecoBonus + b.luxuryBonus + b.landmarkBonus} pts ({b.status})</span>
              {b.status === "approved" && (
                <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/buildings/${b.id}/void`, { reason: "Voided by moderator." })}>
                  Void
                </WoodButton>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="w-full">
        <PanelTitle>INSPECTIONS</PanelTitle>
        {inspections.length === 0 && <p className="text-white/70 text-center py-4">No inspections filed.</p>}
        <div className="space-y-2">
          {inspections.map((i) => (
            <div key={i.id} className="bg-[#764A21]/40 rounded-lg p-3 flex justify-between items-center text-white">
              <span>{i.challengerTeamName} → {i.targetTeamName} ({i.targetBuilding?.deedNumber})</span>
              <span>{i.result}</span>
              {i.result === "cancelled" && (
                <div className="flex gap-2">
                  <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/inspections/${i.id}/resolve`, { result: "passed" })}>Pass</WoodButton>
                  <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/inspections/${i.id}/resolve`, { result: "failed" })}>Fail</WoodButton>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </PageFrame>
  );
}
