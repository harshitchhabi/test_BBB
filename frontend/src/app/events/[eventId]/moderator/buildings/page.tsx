"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";

// Section 7.9 Build desk controls: verify recipe, void deed, resolve
// inspection.
export default function ModeratorBuildingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [buildings, setBuildings] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const b = await fetch(`/api/events/${eventId}/buildings/list`).then((r) => r.json());
    setBuildings(b.buildings);
    const i = await fetch(`/api/events/${eventId}/inspections/list`).then((r) => r.json());
    setInspections(i.inspections);
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

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 900 }}>
      <ModNav eventId={eventId} />
      <h1>Build / Deed Desk</h1>
      {message && <p style={{ color: "crimson" }}>{message}</p>}

      <h2>Constructed buildings</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ textAlign: "left" }}>Deed</th><th>Team</th><th>Building</th><th style={{ textAlign: "right" }}>Points</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {buildings.map((b) => (
            <tr key={b.id}>
              <td>{b.deedNumber}</td>
              <td>{b.teamName}</td>
              <td>{b.recipeName}</td>
              <td style={{ textAlign: "right" }}>{b.basePoints + b.ecoBonus + b.luxuryBonus + b.landmarkBonus}</td>
              <td>{b.status}</td>
              <td>
                {b.status === "approved" && (
                  <button disabled={busy} onClick={() => call(`/api/events/${eventId}/buildings/${b.id}/void`, { reason: "Voided by moderator." })}>Void</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "2rem" }}>Inspections</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ textAlign: "left" }}>Challenger</th><th>Target</th><th>Result</th><th></th></tr>
        </thead>
        <tbody>
          {inspections.map((i) => (
            <tr key={i.id}>
              <td>{i.challengerTeamName}</td>
              <td>{i.targetTeamName} — {i.targetBuilding?.deedNumber}</td>
              <td>{i.result}</td>
              <td>
                {i.result === "cancelled" && (
                  <>
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/inspections/${i.id}/resolve`, { result: "passed" })}>Pass</button>
                    <button disabled={busy} onClick={() => call(`/api/events/${eventId}/inspections/${i.id}/resolve`, { result: "failed" })}>Fail</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
