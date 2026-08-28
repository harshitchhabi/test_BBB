"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { TeamNav } from "./team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, StatTile, WoodButton } from "@/components/theme/Panel";

// Section 7.2 Team home / event lobby — restyled with the legacy team
// page's exact visual language: the team/header-bg.png banner and
// create/join button images from BeforeTeamView, the wooden hanging-sign
// panel from AfterTeamView once a team exists.
export default function EventHomePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [newLeaderEmail, setNewLeaderEmail] = useState("");
  const [teamMessage, setTeamMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/overview`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setOverview(body);
      setLoadError(null);
    } else {
      setLoadError(body?.message ?? `Couldn't load this event (${res.status}). Double-check the event id.`);
    }
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

  async function leaveTeam() {
    setTeamMessage(null);
    const res = await fetch(`/api/events/${eventId}/teams/leave`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) setTeamMessage(body.message);
    else refresh();
  }

  async function transferLeadership() {
    if (!overview?.myTeam) return;
    setTeamMessage(null);
    const res = await fetch(`/api/events/${eventId}/teams/${overview.myTeam.id}/transfer-leadership`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newLeaderEmail }),
    });
    const body = await res.json();
    if (!res.ok) setTeamMessage(body.message);
    else {
      setNewLeaderEmail("");
      refresh();
    }
  }

  if (status === "unauthenticated") {
    return (
      <PageFrame>
        <HeaderBanner>BRICKS BY BID</HeaderBanner>
        <WoodButton variant="primary" onClick={() => signIn("google")}>Sign in with Google</WoodButton>
      </PageFrame>
    );
  }
  if (loadError) {
    return (
      <PageFrame>
        <p className="text-red-300 text-center mt-8">{loadError}</p>
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
  const currentIndex = stageOrder.indexOf(overview.event.status);

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner image="/assets/images/team/header-bg.png">{overview.event.name}</HeaderBanner>

      <Panel className="mb-6">
        <div className="flex flex-wrap gap-2 justify-center text-[#F1EBB5] text-sm md:text-base">
          {stageOrder.map((s, i) => (
            <span key={s} className={i <= currentIndex ? "font-bold" : "opacity-40"}>
              {s}
              {i < stageOrder.length - 1 ? " → " : ""}
            </span>
          ))}
        </div>
      </Panel>

      {overview.myTeam ? (
        <div className="flex flex-col items-center space-y-6 text-center bg-[#5e3c1c] p-6 rounded-xl border-4 border-[#3b2a1a] shadow-lg w-full max-w-md">
          <div className="bg-[#3b2a1a] text-white px-6 py-4 rounded shadow-inner border-4 border-[#a58d6f] relative w-full">
            <h2 className="text-2xl font-bold">TEAM {overview.myTeam.name?.toUpperCase()}</h2>
            <p className="text-yellow-300 font-semibold mt-1">Code: {overview.myTeam.code}</p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <StatTile label="Stage 1" value={overview.myTeam.auctionTokens} />
              <StatTile label="City Wallet" value={overview.myTeam.cityWalletTokens} />
              <StatTile label="Trades used" value={overview.myTeam.tradeCount} />
            </div>
          </div>

          {overview.myRole === "leader" && (
            <div className="w-full bg-[#3b2a1a]/70 rounded p-3">
              <p className="text-yellow-300 text-sm mb-2">Transfer leadership to a teammate (they must have signed in already):</p>
              <div className="flex gap-2">
                <input
                  value={newLeaderEmail}
                  onChange={(e) => setNewLeaderEmail(e.target.value)}
                  placeholder="teammate@email.com"
                  className="flex-1 px-2 py-1 rounded text-black text-sm"
                />
                <WoodButton className="text-sm px-3 py-1" onClick={transferLeadership} disabled={!newLeaderEmail}>
                  Transfer
                </WoodButton>
              </div>
            </div>
          )}

          <WoodButton variant="danger" onClick={leaveTeam}>Leave team</WoodButton>
          {teamMessage && <p className="text-red-300">{teamMessage}</p>}
        </div>
      ) : (
        <Panel className="w-full max-w-lg">
          <div className="flex justify-center gap-10 mb-6">
            <button className="cursor-pointer flex flex-col items-center" onClick={createTeam} disabled={!teamName}>
              <img src="/assets/images/team/create-button.png" alt="Create Team" width={120} height={120} />
              <span className="text-[#F1EBB5] mt-1">Create</span>
            </button>
            <button className="cursor-pointer flex flex-col items-center" onClick={joinTeam} disabled={!joinCode}>
              <img src="/assets/images/team/join-button.png" alt="Join Team" width={120} height={120} />
              <span className="text-[#F1EBB5] mt-1">Join</span>
            </button>
          </div>
          <div className="space-y-3">
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" className="w-full px-3 py-2 rounded text-black" />
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Join code" className="w-full px-3 py-2 rounded text-black" />
          </div>
          {message && <p className="text-red-300 mt-3">{message}</p>}
        </Panel>
      )}

      {(overview.event.status === "setup" || overview.event.status === "lobby") && (
        <p className="mt-6 text-[#F1EBB5]">Waiting for the moderator to start Stage 1…</p>
      )}
    </PageFrame>
  );
}
