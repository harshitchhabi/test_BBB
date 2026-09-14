"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";
import { ConfirmDialog, type ConfirmDialogState } from "@/components/theme/ConfirmDialog";

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
  const [staffPassword, setStaffPassword] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<{ username: string; password: string } | null>(null);
  const [staffList, setStaffList] = useState<Array<{ participantId: string; name: string; username: string }> | null>(null);
  const [staffListError, setStaffListError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);

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

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Self-service — changes the signed-in staff member's own password
  // without signing them out (see auth-service.ts's changeOwnPassword for
  // why: unlike an admin-forced reset on someone ELSE's login, there's no
  // "kick out the old session" step needed when you're changing your own).
  async function changeMyPassword() {
    if (passwordBusy || !currentPassword || !newPassword) return;
    setPasswordBusy(true);
    setPasswordMessage(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setPasswordMessage({ text: body.message ?? `Error (${res.status})`, ok: false });
      else {
        setPasswordMessage({ text: "Password changed.", ok: true });
        setCurrentPassword("");
        setNewPassword("");
      }
    } finally {
      setPasswordBusy(false);
    }
  }

  // The Rules page (frontend/src/app/events/[eventId]/rules/page.tsx)
  // reads every one of these straight off event_settings - this form
  // edits the exact same row. Starts empty; seeded from `overview` once
  // it loads (below), so edits always begin from the real current
  // values instead of the field defaults.
  const [settingsForm, setSettingsForm] = useState<Record<string, string | boolean>>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/overview`);
    if (res.ok) setOverview(await res.json());
  }, [eventId]);

  const refreshStaffList = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/staff`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setStaffList(body.staff);
      setStaffListError(null);
    } else {
      setStaffListError(body?.message ?? `Couldn't load staff (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      refresh();
      refreshStaffList();
    }
  }, [sessionStatus, refresh, refreshStaffList]);

  useEffect(() => {
    if (overview?.settings && !settingsLoaded) {
      const s = overview.settings;
      setSettingsForm({
        stage1StartingTokens: String(s.stage1StartingTokens),
        cityWalletTokens: String(s.cityWalletTokens),
        minimumRaiseStandard: String(s.minimumRaiseStandard),
        minimumRaiseLowOpening: String(s.minimumRaiseLowOpening),
        lowOpeningThreshold: String(s.lowOpeningThreshold),
        cityMinimumRaise: String(s.cityMinimumRaise),
        tradeLimit: String(s.tradeLimit),
        normalBankTaxPercent: String(s.normalBankTaxPercent),
        rareBankTaxPercent: String(s.rareBankTaxPercent),
        scoutReportCost: String(s.scoutReportCost),
        scoutReportLimit: String(s.scoutReportLimit),
        inspectionCost: String(s.inspectionCost),
        inspectionLimitPerTeam: String(s.inspectionLimitPerTeam),
        auctionLotDurationSeconds: String(s.auctionLotDurationSeconds),
        cityAuctionDurationSeconds: String(s.cityAuctionDurationSeconds),
        leftoverUnitsPerPoint: String(s.leftoverUnitsPerPoint),
        advancedCityScoringPenalty: String(s.advancedCityScoringPenalty),
        inspectionsEnabled: Boolean(s.inspectionsEnabled),
        scoutReportsEnabled: Boolean(s.scoutReportsEnabled),
        leftoverScoringEnabled: Boolean(s.leftoverScoringEnabled),
        advancedCityScoringEnabled: Boolean(s.advancedCityScoringEnabled),
        customRulesNote: s.customRulesNote ?? "",
      });
      setSettingsLoaded(true);
    }
  }, [overview, settingsLoaded]);

  const INTEGER_SETTINGS_FIELDS: Array<[string, string]> = [
    ["stage1StartingTokens", "Stage 1 starting tokens"],
    ["cityWalletTokens", "City wallet tokens"],
    ["minimumRaiseStandard", "Minimum raise (standard)"],
    ["minimumRaiseLowOpening", "Minimum raise (low opening)"],
    ["lowOpeningThreshold", "Low opening threshold"],
    ["cityMinimumRaise", "City minimum raise"],
    ["tradeLimit", "Trade limit per team"],
    ["normalBankTaxPercent", "Bank tax % (normal)"],
    ["rareBankTaxPercent", "Bank tax % (rare)"],
    ["scoutReportCost", "Scout report cost"],
    ["scoutReportLimit", "Scout report limit per team"],
    ["inspectionCost", "Inspection cost"],
    ["inspectionLimitPerTeam", "Inspection limit per team"],
    ["auctionLotDurationSeconds", "Auction lot duration (sec)"],
    ["cityAuctionDurationSeconds", "City auction duration (sec)"],
    ["leftoverUnitsPerPoint", "Leftover units per point"],
    ["advancedCityScoringPenalty", "Advanced scoring penalty"],
  ];
  const BOOLEAN_SETTINGS_FIELDS: Array<[string, string]> = [
    ["inspectionsEnabled", "Inspections enabled"],
    ["scoutReportsEnabled", "Scout reports enabled"],
    ["leftoverScoringEnabled", "Leftover scoring enabled"],
    ["advancedCityScoringEnabled", "Advanced city scoring enabled"],
  ];

  async function saveSettings() {
    if (settingsBusy) return;
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const updates: Record<string, number | boolean | string> = {};
      for (const [key] of INTEGER_SETTINGS_FIELDS) {
        const raw = settingsForm[key];
        if (typeof raw === "string" && raw.trim() !== "") updates[key] = Number(raw);
      }
      for (const [key] of BOOLEAN_SETTINGS_FIELDS) {
        updates[key] = Boolean(settingsForm[key]);
      }
      updates.customRulesNote = typeof settingsForm.customRulesNote === "string" ? settingsForm.customRulesNote : "";

      const res = await fetch(`/api/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      const body = await res.json();
      if (!res.ok) setSettingsMessage(body.message);
      else {
        setSettingsMessage("Saved.");
        refresh();
      }
    } finally {
      setSettingsBusy(false);
    }
  }

  // Frees the username for reuse without touching this login's history —
  // see team-service.ts's deleteStaffLogin. Refuses to remove the last
  // remaining staff login server-side, so this can't lock the event out.
  function removeStaff(participantId: string, name: string) {
    if (removeBusy) return;
    setConfirmState({
      title: "Remove staff login",
      message: `Remove staff login "${name}"? This frees the username for reuse.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: (reason) => doRemoveStaff(participantId, reason),
    });
  }

  async function doRemoveStaff(participantId: string, reason: string) {
    setRemoveBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/staff/${participantId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setStaffListError(body?.message ?? "Couldn't remove that staff login.");
      else refreshStaffList();
    } finally {
      setRemoveBusy(false);
    }
  }

  async function addStaff() {
    if (staffBusy) return;
    setStaffBusy(true);
    setMessage(null);
    setIssuedCredential(null);
    try {
      const res = await fetch(`/api/events/${eventId}/staff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: staffName, username: staffUsername, password: staffPassword || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.message);
      } else {
        setIssuedCredential({ username: body.username, password: body.password });
        setStaffName("");
        setStaffUsername("");
        setStaffPassword("");
        refreshStaffList();
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
  // forward-only sequence. A reason is optional (recorded with a
  // placeholder if left blank); the confirmation checkbox is the actual
  // safety gate. The server voids whatever round/auction is currently
  // live rather than abandoning it.
  async function forceStage() {
    if (forceBusy || !forceTarget || !forceConfirmed) return;
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
        <PanelTitle>CHANGE MY PASSWORD</PanelTitle>
        <p className="text-white/70 text-sm mb-3">Updates your own login — you stay signed in, no need to log back in.</p>
        <div className="flex gap-2 flex-wrap">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="flex-1 min-w-40 px-3 py-2 rounded text-black"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 6 characters)"
            className="flex-1 min-w-40 px-3 py-2 rounded text-black"
          />
          <WoodButton variant="primary" onClick={changeMyPassword} disabled={passwordBusy || !currentPassword || !newPassword}>
            {passwordBusy ? "Saving…" : "Change password"}
          </WoodButton>
        </div>
        {passwordMessage && (
          <p className={`px-3 py-2 rounded-md font-medium mt-3 ${passwordMessage.ok ? "text-green-100 bg-green-950/80" : "text-red-100 bg-red-950/80"}`}>
            {passwordMessage.text}
          </p>
        )}
      </Panel>

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
                placeholder={currentStatus === "paused" ? "Reason to resume (optional)" : "Reason to pause (optional)"}
                className="w-full px-3 py-2 rounded text-black mb-2"
              />
            )}
            <div className="flex gap-2 flex-wrap">
              {nextOptions.length === 0 && <p className="text-white/70">This event is finished — no further stage changes.</p>}
              {nextOptions.map((next) => (
                <WoodButton
                  key={next}
                  variant={next === "paused" ? "danger" : "primary"}
                  disabled={stageBusy}
                  onClick={() => advanceTo(next)}
                >
                  {next === "paused" ? "Pause event" : `Advance to: ${STAGE_LABELS[next] ?? next}`}
                </WoodButton>
              ))}
            </div>
            {stageMessage && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mt-3">{stageMessage}</p>}
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
        {forceMessage && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mt-3">{forceMessage}</p>}
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
          placeholder="Reason (optional, e.g. 'End of round 1')"
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
        <WoodButton variant="danger" disabled={resetBusy || !resetConfirmed} onClick={resetForNewRound}>
          Reset event for a new round
        </WoodButton>
        {resetMessage && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mt-3">{resetMessage}</p>}
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
          <input
            value={staffPassword}
            onChange={(e) => setStaffPassword(e.target.value)}
            placeholder="password (optional — auto-generated if left blank)"
            className="flex-1 min-w-64 px-3 py-2 rounded text-black"
          />
          <WoodButton variant="primary" onClick={addStaff} disabled={staffBusy || !staffName || !staffUsername}>
            {staffBusy ? "Creating…" : "Create"}
          </WoodButton>
        </div>
        {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mt-3">{message}</p>}
        {issuedCredential && (
          <div className="mt-3 bg-black/40 rounded p-3 text-sm">
            <p className="text-yellow-300 font-bold">Shown once — write it down now:</p>
            <p className="text-white">
              Username: <strong>{issuedCredential.username}</strong> · Password: <strong>{issuedCredential.password}</strong>
            </p>
          </div>
        )}
      </Panel>

      <Panel className="w-full max-w-lg mt-4">
        <PanelTitle>CURRENT STAFF</PanelTitle>
        {staffListError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-2">{staffListError}</p>}
        {!staffListError && !staffList && <p className="text-white/70">Loading…</p>}
        {staffList && staffList.length === 0 && <p className="text-white/70">No staff logins yet.</p>}
        {staffList && staffList.length > 0 && (
          <ul className="divide-y divide-white/10">
            {staffList.map((s) => (
              <li key={s.participantId} className="flex items-center justify-between gap-2 py-2">
                <span className="text-white">
                  {s.name} <span className="text-white/60">({s.username})</span>
                </span>
                <WoodButton variant="danger" disabled={removeBusy} onClick={() => removeStaff(s.participantId, s.name)}>
                  Remove
                </WoodButton>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="w-full max-w-lg mt-4">
        <PanelTitle>RULES &amp; SETTINGS</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          Everything below is exactly what the Rules page shows every team. The note is free text — announcements,
          house rules, anything the structured numbers below don&apos;t cover.
        </p>
        {!settingsLoaded ? (
          <p className="text-white/70">Loading…</p>
        ) : (
          <>
            <label className="block text-yellow-300 text-sm font-bold mb-1">Custom rules note</label>
            <textarea
              value={typeof settingsForm.customRulesNote === "string" ? settingsForm.customRulesNote : ""}
              onChange={(e) => setSettingsForm((f) => ({ ...f, customRulesNote: e.target.value }))}
              placeholder="Shown at the top of the Rules page for every team."
              rows={4}
              maxLength={4000}
              className="w-full px-3 py-2 rounded text-black mb-4"
            />

            <div className="grid grid-cols-2 gap-2 mb-4">
              {INTEGER_SETTINGS_FIELDS.map(([key, label]) => (
                <label key={key} className="text-white/90 text-xs">
                  {label}
                  <input
                    type="number"
                    value={typeof settingsForm[key] === "string" ? (settingsForm[key] as string) : ""}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full px-2 py-1 rounded text-black mt-0.5"
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-1 mb-4">
              {BOOLEAN_SETTINGS_FIELDS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-white/90 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(settingsForm[key])}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, [key]: e.target.checked }))}
                    className="w-4 h-4 accent-yellow-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            <WoodButton variant="primary" disabled={settingsBusy} onClick={saveSettings}>
              {settingsBusy ? "Saving…" : "Save rules & settings"}
            </WoodButton>
            {settingsMessage && <p className="text-yellow-300 mt-3">{settingsMessage}</p>}
          </>
        )}
      </Panel>

      <p className="mt-6 text-white/70 max-w-lg text-center">
        Materials, recipes, Market Shock cards, and city blocks are configured via <code>packages/db/seed/data.ts</code>
        and applied with <code>npx tsx seed/run.ts</code> before the event starts.
      </p>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </PageFrame>
  );
}
