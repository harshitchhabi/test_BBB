"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { TeamNav } from "./team-nav";

// Section 7.2 Team home / event lobby: event title/stage, team info,
// token summary cards, "waiting for moderator" state when nothing to do.
export default function EventHomePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [teamName, setTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/overview`);
    if (res.ok) setOverview(await res.json());
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  async function createTeam() {
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/teams`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: teamName }) });
    const body = await res.json();
    if (!res.ok) setMessage(body.message);
    else {
      setTeamName("");
      refresh();
    }
  }

  async function joinTeam() {
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/teams/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: joinCode }) });
    const body = await res.json();
    if (!res.ok) setMessage(body.message);
    else {
      setJoinCode("");
      refresh();
    }
  }

  if (status === "unauthenticated") {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1>Bricks by Bid</h1>
        <button onClick={() => signIn("google")}>Sign in with Google</button>
      </main>
    );
  }
  if (status === "loading" || !overview) return <main style={{ padding: "2rem" }}>Loading…</main>;

  const stageOrder = ["setup", "lobby", "stage_1", "stage_2", "stage_3", "scoring", "completed"];
  const currentIndex = stageOrder.indexOf(overview.event.status);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 800 }}>
      <TeamNav eventId={eventId} />
      <h1>{overview.event.name}</h1>
      <p>
        Stage: <strong>{overview.event.status}</strong>
      </p>

      <section style={{ display: "flex", gap: "1rem", margin: "1rem 0" }}>
        {stageOrder.map((s, i) => (
          <span key={s} style={{ opacity: i <= currentIndex ? 1 : 0.35, fontWeight: s === overview.event.status ? 700 : 400 }}>
            {s}
            {i < stageOrder.length - 1 ? " →" : ""}
          </span>
        ))}
      </section>

      {overview.myTeam ? (
        <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem" }}>
          <h2>Your team: {overview.myTeam.name}</h2>
          <p>Code: {overview.myTeam.code}</p>
          <p>Role: {overview.myRole}</p>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <div>Stage 1 tokens: <strong>{overview.myTeam.auctionTokens}</strong></div>
            <div>City wallet: <strong>{overview.myTeam.cityWalletTokens}</strong></div>
            <div>Trades used: <strong>{overview.myTeam.tradeCount}</strong></div>
          </div>
        </section>
      ) : (
        <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem" }}>
          <h2>Join or create a team</h2>
          <div style={{ marginBottom: "1rem" }}>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" />
            <button onClick={createTeam} disabled={!teamName}>Create team</button>
          </div>
          <div>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Join code" />
            <button onClick={joinTeam} disabled={!joinCode}>Join team</button>
          </div>
          {message && <p style={{ color: "crimson" }}>{message}</p>}
        </section>
      )}

      {overview.event.status === "setup" || overview.event.status === "lobby" ? (
        <p style={{ marginTop: "1.5rem", color: "#666" }}>Waiting for the moderator to start Stage 1…</p>
      ) : null}
    </main>
  );
}
