"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
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
  const [staffName, setStaffName] = useState("");
  const [staffUsername, setStaffUsername] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<{ username: string; password: string } | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [pauseReason, setPauseReason] = useState("");

  const [resetReason, setResetReason] = useState("");
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const [forceTarget, setForceTarget] = useState("");
  const [forceReason, setForceReason] = useState("");
  const [forceConfirmed, setForceConfirmed] = useState(false);
  const [forceBusy, setForceBusy] = useState(false);
  const [forceMessage, setForceMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/overview`);
    if (res.ok) setOverview(await res.json());
  }, [eventId]);

  useEffect(() => {
    if (sessionStatus === "authenticated") refresh();
  }, [sessionStatus, refresh]);

  async function addStaff() {
    if (staffBusy) return;
    setStaffBusy(true);
    setMessage(null);
    setIssuedCredential(null);
    try {
      const res = await fetch(`/api/events/${eventId}/staff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: staffName, username: staffUsername }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.message);
      } else {
        setIssuedCredential({ username: body.username, password: body.password });
        setStaffName("");
        setStaffUsername("");
      }
    } finally {
      setStaffBusy(false);
    }
  }

  async function advanceTo(nextStatus: string) {
    if (stageBusy) return;
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
    if (resetBusy) return;
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

  // Task 3: jump straight to any real stage, bypassing the normal
  // forward-only sequence. Always requires a reason; the server voids
  // whatever round/auction is currently live rather than abandoning it.
  async function forceStage() {
    if (forceBusy || !forceTarget || !forceReason || !forceConfirmed) return;
    setForceBusy(true);
    setForceMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: forceTarget, reason: forceReason, force: true }),
      });
      const body = await res.json();
      if (!res.ok) setForceMessage(body.message);
      else {
        setForceTarget("");
        setForceReason("");
        setForceConfirmed(false);
        refresh();
      }
    } finally {
      setForceBusy(false);
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
        <PanelTitle>FORCE JUMP TO ANY STAGE</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          Skips the normal forward-only sequence — jump to any stage, forward or backward. Whatever auction round or
          city auction is currently live gets voided (its tokens/materials returned) rather than left dangling.
        </p>
        <div className="flex gap-2 flex-wrap mb-2">
          <select value={forceTarget} onChange={(e) => setForceTarget(e.target.value)} className="px-2 py-2 rounded text-black">
            <option value="">Choose a stage…</option>
            {Object.entries(STAGE_LABELS)
              .filter(([key]) => key !== currentStatus)
              .map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
          </select>
        </div>
        <input
          value={forceReason}
          onChange={(e) => setForceReason(e.target.value)}
          placeholder="Reason (required)"
          className="w-full px-3 py-2 rounded text-black mb-2"
        />
        <label className="flex items-center gap-2 text-white/90 text-sm mb-3">
          <input type="checkbox" checked={forceConfirmed} onChange={(e) => setForceConfirmed(e.target.checked)} className="w-5 h-5 accent-red-500 shrink-0" />
          I understand this bypasses the normal sequence and voids anything currently live.
        </label>
        <WoodButton variant="danger" disabled={forceBusy || !forceTarget || !forceReason || !forceConfirmed} onClick={forceStage}>
          Force stage change
        </WoodButton>
        {forceMessage && <p className="text-red-300 mt-3">{forceMessage}</p>}
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
        <PanelTitle>CREATE A STAFF LOGIN</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          Issues a brand-new username + password for this event's staff console. If nobody is staff for this event
          yet, anyone can create the first one; after that, only existing staff can create more.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="Name (e.g. 'Front desk')" className="flex-1 min-w-40 px-3 py-2 rounded text-black" />
          <input value={staffUsername} onChange={(e) => setStaffUsername(e.target.value)} placeholder="username" className="flex-1 min-w-32 px-3 py-2 rounded text-black" />
          <WoodButton variant="primary" onClick={addStaff} disabled={staffBusy || !staffName || !staffUsername}>
            {staffBusy ? "Creating…" : "Create"}
          </WoodButton>
        </div>
        {message && <p className="text-red-300 mt-3">{message}</p>}
        {issuedCredential && (
          <div className="mt-3 bg-black/40 rounded p-3 text-sm">
            <p className="text-yellow-300 font-bold">Shown once — write it down now:</p>
            <p className="text-white">
              Username: <strong>{issuedCredential.username}</strong> · Password: <strong>{issuedCredential.password}</strong>
            </p>
          </div>
        )}
      </Panel>

      <p className="mt-6 text-white/70 max-w-lg text-center">
        Materials, recipes, Market Shock cards, and city blocks are configured via <code>packages/db/seed/data.ts</code>
        and applied with <code>npx tsx seed/run.ts</code> before the event starts.
      </p>
    </PageFrame>
  );
}
