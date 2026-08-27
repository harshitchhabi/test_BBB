"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.8 "Event Setup" nav item. Materials/recipes/shocks/cities are
// seeded from packages/db/seed (Phase 0) rather than authored through a
// UI. This screen covers the two things that genuinely need a person:
// adding moderators, and — the big one — actually advancing the event
// through its stages. Nothing else in the system ever did this: without
// a control here, the event stays stuck at "setup" forever and every
// stage-gated action (starting Stage 1, trading, city auctions) fails.
const STAGE_LABELS: Record<string, string> = {
  setup: "Setup",
  lobby: "Lobby (teams can register)",
  stage_1: "Stage 1 — Material Auction",
  stage_2: "Stage 2 — Trade & Build",
  stage_3: "Stage 3 — City Auction",
  scoring: "Scoring",
  completed: "Completed",
  paused: "Paused",
};

export default function ModeratorSetupPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status: sessionStatus } = useSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"moderator" | "admin">("moderator");
  const [message, setMessage] = useState<string | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [pauseReason, setPauseReason] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/overview`);
    if (res.ok) setOverview(await res.json());
  }, [eventId]);

  useEffect(() => {
    if (sessionStatus === "authenticated") refresh();
  }, [sessionStatus, refresh]);

  async function addStaff() {
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetEmail: email, role }),
    });
    const body = await res.json();
    setMessage(res.ok ? `Added ${email} as ${role}.` : body.message);
    if (res.ok) setEmail("");
  }

  async function advanceTo(nextStatus: string) {
    setStageBusy(true);
    setStageMessage(null);
    try {
      const needsReason = nextStatus === "paused" || overview?.event?.status === "paused";
      const res = await fetch(`/api/events/${eventId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reason: needsReason ? pauseReason || "Paused by moderator." : undefined }),
      });
      const body = await res.json();
      if (!res.ok) setStageMessage(body.message);
      else {
        setPauseReason("");
        refresh();
      }
    } finally {
      setStageBusy(false);
    }
  }

  const VALID_NEXT: Record<string, string[]> = {
    setup: ["lobby", "paused"],
    lobby: ["stage_1", "paused"],
    stage_1: ["stage_2", "paused"],
    stage_2: ["stage_3", "paused"],
    stage_3: ["scoring", "completed", "paused"],
    scoring: ["completed", "paused"],
    paused: ["setup", "lobby", "stage_1", "stage_2", "stage_3", "scoring"],
    completed: [],
  };
  const currentStatus = overview?.event?.status;
  const nextOptions = currentStatus ? VALID_NEXT[currentStatus] ?? [] : [];

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>EVENT SETUP</HeaderBanner>

      <Panel className="w-full max-w-lg mb-4">
        <PanelTitle>EVENT STAGE</PanelTitle>
        {overview ? (
          <>
            <p className="text-white mb-3">
              Current stage: <strong>{STAGE_LABELS[currentStatus] ?? currentStatus}</strong>
            </p>
            {(nextOptions.includes("paused") || currentStatus === "paused") && (
              <input
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder={currentStatus === "paused" ? "Reason to resume (required)" : "Reason to pause (required)"}
                className="w-full px-3 py-2 rounded text-black mb-2"
              />
            )}
            <div className="flex gap-2 flex-wrap">
              {nextOptions.length === 0 && <p className="text-white/70">This event is finished — no further stage changes.</p>}
              {nextOptions.map((next) => (
                <WoodButton
                  key={next}
                  variant={next === "paused" ? "danger" : "primary"}
                  disabled={stageBusy || ((next === "paused" || currentStatus === "paused") && !pauseReason)}
                  onClick={() => advanceTo(next)}
                >
                  {next === "paused" ? "Pause event" : `Advance to: ${STAGE_LABELS[next] ?? next}`}
                </WoodButton>
              ))}
            </div>
            {stageMessage && <p className="text-red-300 mt-3">{stageMessage}</p>}
          </>
        ) : (
          <p className="text-white/70">Loading…</p>
        )}
      </Panel>

      <Panel className="w-full max-w-lg">
        <PanelTitle>ADD A MODERATOR</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          The person must have signed in at least once. If nobody is staff for this event yet, anyone can add the
          first one; after that, only existing staff can add more.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their-email@example.com" className="flex-1 min-w-48 px-3 py-2 rounded text-black" />
          <select value={role} onChange={(e) => setRole(e.target.value as "moderator" | "admin")} className="px-2 py-2 rounded text-black">
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
          <WoodButton variant="primary" onClick={addStaff} disabled={!email}>Add</WoodButton>
        </div>
        {message && <p className="text-yellow-300 mt-3">{message}</p>}
      </Panel>

      <p className="mt-6 text-white/70 max-w-lg text-center">
        Materials, recipes, Market Shock cards, and city blocks are configured via <code>packages/db/seed/data.ts</code>
        and applied with <code>npx tsx seed/run.ts</code> before the event starts.
      </p>
    </PageFrame>
  );
}
