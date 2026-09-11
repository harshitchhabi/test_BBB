"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.8 "Event Setup" nav item. Materials/recipes/shocks/cities are
// seeded from packages/db/seed (Phase 0) rather than authored through a
// UI. This screen covers what genuinely needs a person: advancing the
// event through its stages (nothing else in the system does this —
// without it the event stays stuck at "setup" forever), resetting the
// whole event for a fresh round with a new set of teams on the same
// event id/link (for running the same event multiple times — ~20-30
// teams per round, not a fixed number), and adding moderators.
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

  const [resetReason, setResetReason] = useState("");
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

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

  async function resetForNewRound() {
    setResetBusy(true);
    setResetMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: resetReason }),
      });
      const body = await res.json();
      if (!res.ok) setResetMessage(body.message);
      else {
        setResetReason("");
        setResetConfirmed(false);
        refresh();
      }
    } finally {
      setResetBusy(false);
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

      <Panel className="w-full max-w-lg mb-4 border-2 border-red-800">
        <PanelTitle>RESET FOR A NEW ROUND</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          Permanently deletes every team, token balance, bid, trade, building, city assignment, and score for this
          event — the same event id/link keeps working, ready for a brand new set of teams. Materials, recipes,
          city list, and settings are kept exactly as configured. This cannot be undone (though the audit log of
          the round you're ending is kept).
        </p>
        <input
          value={resetReason}
          onChange={(e) => setResetReason(e.target.value)}
          placeholder="Reason (e.g. 'End of round 1') — required"
          className="w-full px-3 py-2 rounded text-black mb-2"
        />
        <label className="flex items-center gap-2 text-white/90 text-sm mb-3">
          <input
            type="checkbox"
            checked={resetConfirmed}
            onChange={(e) => setResetConfirmed(e.target.checked)}
            className="w-5 h-5 accent-red-500 shrink-0"
          />
          I understand this deletes all teams and progress for this event.
        </label>
        <WoodButton variant="danger" disabled={resetBusy || !resetReason || !resetConfirmed} onClick={resetForNewRound}>
          Reset event for a new round
        </WoodButton>
        {resetMessage && <p className="text-red-300 mt-3">{resetMessage}</p>}
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
