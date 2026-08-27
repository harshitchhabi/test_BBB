"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { TeamNav } from "../team-nav";

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

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
    if (!ov.myTeam) return;

    const bld = await fetch(`/api/events/${eventId}/buildings/list?teamId=${ov.myTeam.id}`).then((r) => r.json());
    setBuildings(bld.buildings);

    if (ov.event.status === "completed") {
      const board = await fetch(`/api/events/${eventId}/scoreboard`).then((r) => r.json());
      setStanding(board.standings.find((s: any) => s.teamId === ov.myTeam.id) ?? null);
    } else {
      const pre = await fetch(`/api/events/${eventId}/teams/${ov.myTeam.id}/pre-reveal-score`).then((r) => r.json());
      setPreReveal(pre);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  if (!overview) return <main style={{ padding: "2rem" }}>Loading…</main>;
  if (!overview.myTeam) return (
    <main style={{ padding: "2rem" }}>
      <TeamNav eventId={eventId} />
      <p>Join a team first.</p>
    </main>
  );

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 800 }}>
      <TeamNav eventId={eventId} />
      <h1>Portfolio & Score</h1>

      <h2>Approved buildings</h2>
      <ul>
        {buildings.filter((b) => b.status === "approved").map((b) => (
          <li key={b.id}>
            {b.recipeName} — {b.basePoints} pts{b.ecoBonus ? ` +${b.ecoBonus} Eco` : ""}{b.luxuryBonus ? ` +${b.luxuryBonus} Luxury` : ""}{b.landmarkBonus ? ` +${b.landmarkBonus} Landmark` : ""}
          </li>
        ))}
      </ul>

      {standing ? (
        <section style={{ border: "2px solid #444", borderRadius: 8, padding: "1rem", marginTop: "1.5rem" }}>
          <h2>Final score: {standing.finalScore}</h2>
          <p>Building points: {standing.buildingPoints} · Bonus points: {standing.bonusPoints} · Leftover points: {standing.leftoverPoints}</p>
          <p>City multiplier: ×{standing.cityMultiplier}</p>
          <p>Rank: #{standing.rank} (placement #{standing.tiebreakerRank})</p>
          <details>
            <summary>Full calculation</summary>
            <pre>{JSON.stringify(standing.calculationJson, null, 2)}</pre>
          </details>
        </section>
      ) : preReveal ? (
        <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", marginTop: "1.5rem" }}>
          <h2>Pre-reveal score: {preReveal.preMultiplierTotal}</h2>
          <p>Building points: {preReveal.buildingPoints} · Bonus points: {preReveal.bonusPoints} · Leftover points: {preReveal.leftoverPoints}</p>
          {preReveal.city ? (
            <p>Your city: {preReveal.city.name} ({preReveal.city.tier}) — multiplier revealed once every city is sold.</p>
          ) : (
            <p style={{ color: "#666" }}>You haven't won a city yet.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
