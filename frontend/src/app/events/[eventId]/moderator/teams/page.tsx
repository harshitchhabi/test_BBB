"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { FetchJsonError } from "@/lib/fetch-json";
import { fetchEventOverviewFresh } from "@/lib/use-event-overview";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";
import { ConfirmDialog, type ConfirmDialogState } from "@/components/theme/ConfirmDialog";

// Section 7.9 "Teams & Balances" + "Incidents" (team withdrawal, balance
// adjustment, manual correction) combined into one screen. Task 1 added
// "Create a team login" here too — a team no longer signs itself up, so
// this is the only place a team comes into existence.
export default function ModeratorTeamsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<Record<string, string>>({});
  const [adjustWalletAmount, setAdjustWalletAmount] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Array<{ materialTypeId: string; materialName: string }>>([]);
  const [expandedInventoryTeamId, setExpandedInventoryTeamId] = useState<string | null>(null);
  const [teamInventory, setTeamInventory] = useState<Array<{ materialTypeId: string; quantity: number }>>([]);
  const [inventoryLoadError, setInventoryLoadError] = useState<string | null>(null);
  const [inventoryDelta, setInventoryDelta] = useState<Record<string, string>>({});

  const [teamName, setTeamName] = useState("");
  const [teamUsername, setTeamUsername] = useState("");
  const [teamPassword, setTeamPassword] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [issuedCredential, setIssuedCredential] = useState<{ username: string; password: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);
  // A ref, not the busy state: adjust-tokens in particular is a real
  // double-application risk on a fast double-click (a React state read
  // lags the click event that triggers it), unlike bidding this is
  // never protected by a server-side "only one winner can commit" row
  // lock in the same way - each call is its own independent delta.
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [ov, bankRes] = await Promise.all([
        fetchEventOverviewFresh(eventId) as Promise<any>,
        fetch(`/api/events/${eventId}/bank-stock`).then((r) => r.json()),
      ]);
      setOverview(ov);
      setMaterials(bankRes.stock ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof FetchJsonError ? err.message : "Couldn't load this page. Retrying…");
    }
  }, [eventId]);

  const refreshTeamInventory = useCallback(async (teamId: string) => {
    const res = await fetch(`/api/events/${eventId}/teams/${teamId}/inventory`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setTeamInventory(body.inventory ?? []);
      setInventoryLoadError(null);
    } else {
      setInventoryLoadError(body?.message ?? `Couldn't load inventory (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => {
    refresh();
    if (expandedInventoryTeamId) refreshTeamInventory(expandedInventoryTeamId);
  });
  useEffect(() => {
    if (connected) {
      refresh();
      if (expandedInventoryTeamId) refreshTeamInventory(expandedInventoryTeamId);
    }
  }, [connected, refresh, expandedInventoryTeamId, refreshTeamInventory]);

  function toggleInventoryEditor(teamId: string) {
    if (expandedInventoryTeamId === teamId) {
      setExpandedInventoryTeamId(null);
      return;
    }
    setExpandedInventoryTeamId(teamId);
    setInventoryDelta({});
    refreshTeamInventory(teamId);
  }

  async function applyInventoryAdjustment(teamId: string, materialTypeId: string) {
    const delta = Number(inventoryDelta[materialTypeId]);
    if (busyRef.current || !delta) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/teams/${teamId}/adjust-inventory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ materialTypeId, quantityDelta: delta, reason: "Manual inventory correction." }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.message ?? `Error (${res.status})`);
      else setInventoryDelta((d) => ({ ...d, [materialTypeId]: "" }));
      await refreshTeamInventory(teamId);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function call(path: string, body?: unknown, method: "POST" | "DELETE" = "POST", onSuccess?: () => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(json.message ?? `Error (${res.status})`);
      else onSuccess?.();
      // Refresh either way - see the same fix on the Trade Desk console.
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function deleteTeam(teamId: string, teamName: string) {
    setConfirmState({
      title: "Delete team",
      message: `Permanently delete team "${teamName}"? This cannot be undone (though the audit log keeps a record).`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: (reason) => call(`/api/events/${eventId}/teams/${teamId}`, { reason }, "DELETE"),
    });
  }

  function resetPassword(participantId: string, teamName: string) {
    setConfirmState({
      title: "Reset password",
      message: `Reset the login password for "${teamName}"? Their current session will be signed out.`,
      confirmLabel: "Reset password",
      danger: true,
      onConfirm: async (reason) => {
        setBusy(true);
        setMessage(null);
        setIssuedCredential(null);
        try {
          const res = await fetch(`/api/events/${eventId}/logins/${participantId}/reset-password`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
          else setIssuedCredential({ username: body.username, password: body.password });
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function createTeam() {
    if (createBusy) return;
    setCreateBusy(true);
    setMessage(null);
    setIssuedCredential(null);
    try {
      const res = await fetch(`/api/events/${eventId}/teams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: teamName, username: teamUsername, password: teamPassword || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
      } else {
        setIssuedCredential({ username: body.username, password: body.password });
        setTeamName("");
        setTeamUsername("");
        setTeamPassword("");
        refresh();
      }
    } finally {
      setCreateBusy(false);
    }
  }

  if (loadError && !overview) return <PageFrame><ModNav eventId={eventId} /><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>TEAMS & INCIDENTS</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      <Panel className="w-full mb-4">
        <PanelTitle>CREATE A TEAM LOGIN</PanelTitle>
        <div className="flex gap-2 flex-wrap">
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" className="flex-1 min-w-40 px-3 py-2 rounded text-black" />
          <input value={teamUsername} onChange={(e) => setTeamUsername(e.target.value)} placeholder="username" className="flex-1 min-w-32 px-3 py-2 rounded text-black" />
          <input
            value={teamPassword}
            onChange={(e) => setTeamPassword(e.target.value)}
            placeholder="password (optional - auto-generated if left blank)"
            className="flex-1 min-w-64 px-3 py-2 rounded text-black"
          />
          <WoodButton variant="primary" onClick={createTeam} disabled={createBusy || !teamName || !teamUsername}>
            {createBusy ? "Creating…" : "Create"}
          </WoodButton>
        </div>
        {issuedCredential && (
          <div className="mt-3 bg-black/40 rounded p-3 text-sm">
            <p className="text-yellow-300 font-bold">Shown once - write it down now:</p>
            <p className="text-white">
              Username: <strong>{issuedCredential.username}</strong> · Password: <strong>{issuedCredential.password}</strong>
            </p>
          </div>
        )}
      </Panel>

      <Panel className="w-full">
        {overview.teams.length === 0 && (
          <p className="text-white/70 text-center py-6">No teams have been created for this event yet.</p>
        )}
        <div className="space-y-2">
          {overview.teams.map((t: any) => (
            <div key={t.id} className="bg-[#764A21]/40 rounded-lg p-3 text-white">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div>
                  <strong>{t.name}</strong> ({t.code}) - {t.status}
                  <div className="text-sm text-white/80">
                    Tokens: {t.auctionTokens} · Wallet: {t.cityWalletTokens} · Trades: {t.tradeCount}
                  </div>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    className="w-20 px-2 py-1 rounded text-black text-sm"
                    placeholder="±Stage 1 tokens"
                    value={adjustAmount[t.id] ?? ""}
                    onChange={(e) => setAdjustAmount((a) => ({ ...a, [t.id]: e.target.value }))}
                  />
                  <WoodButton
                    disabled={busy || !adjustAmount[t.id]}
                    onClick={() =>
                      call(`/api/events/${eventId}/teams/${t.id}/adjust-tokens`, { auctionTokensDelta: Number(adjustAmount[t.id]), reason: "Manual correction." }, "POST", () =>
                        setAdjustAmount((a) => ({ ...a, [t.id]: "" })),
                      )
                    }
                  >
                    Apply
                  </WoodButton>
                  <input
                    className="w-20 px-2 py-1 rounded text-black text-sm"
                    placeholder="±city wallet"
                    value={adjustWalletAmount[t.id] ?? ""}
                    onChange={(e) => setAdjustWalletAmount((a) => ({ ...a, [t.id]: e.target.value }))}
                  />
                  <WoodButton
                    disabled={busy || !adjustWalletAmount[t.id]}
                    onClick={() =>
                      call(`/api/events/${eventId}/teams/${t.id}/adjust-tokens`, { cityWalletTokensDelta: Number(adjustWalletAmount[t.id]), reason: "Manual correction." }, "POST", () =>
                        setAdjustWalletAmount((a) => ({ ...a, [t.id]: "" })),
                      )
                    }
                  >
                    Apply
                  </WoodButton>
                  <WoodButton onClick={() => toggleInventoryEditor(t.id)}>
                    {expandedInventoryTeamId === t.id ? "Hide inventory" : "Edit inventory"}
                  </WoodButton>
                  {t.status === "active" ? (
                    <>
                      <WoodButton disabled={busy} onClick={() => call(`/api/events/${eventId}/teams/${t.id}/status`, { status: "withdrawn", reason: "Team withdrew." })}>Withdraw</WoodButton>
                      <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/teams/${t.id}/status`, { status: "disqualified", reason: "Disqualified by moderator." })}>
                        Disqualify
                      </WoodButton>
                    </>
                  ) : (
                    <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/teams/${t.id}/status`, { status: "active", reason: "Reinstated." })}>
                      Reinstate
                    </WoodButton>
                  )}
                  <WoodButton disabled={busy} onClick={() => resetPassword(t.ownerParticipantId, t.name)}>
                    Reset password
                  </WoodButton>
                  <WoodButton variant="danger" disabled={busy} onClick={() => deleteTeam(t.id, t.name)}>
                    Delete
                  </WoodButton>
                </div>
              </div>

              {expandedInventoryTeamId === t.id && (
                <div className="mt-3 bg-black/30 rounded p-3">
                  <p className="text-yellow-300 font-bold text-sm mb-2">EDIT {t.name.toUpperCase()}'S INVENTORY</p>
                  {inventoryLoadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-2 text-sm">{inventoryLoadError}</p>}
                  <div className="space-y-1">
                    {materials.map((m) => {
                      const held = teamInventory.find((i: any) => i.materialTypeId === m.materialTypeId)?.quantity ?? 0;
                      return (
                        <div key={m.materialTypeId} className="flex items-center gap-2 text-sm">
                          <span className="flex-1">{m.materialName}</span>
                          <span className="text-white/70 w-16 text-right">has {held}</span>
                          <input
                            className="w-20 px-2 py-1 rounded text-black text-sm"
                            placeholder="±qty"
                            value={inventoryDelta[m.materialTypeId] ?? ""}
                            onChange={(e) => setInventoryDelta((d) => ({ ...d, [m.materialTypeId]: e.target.value }))}
                          />
                          <WoodButton
                            className="px-2 py-1 text-xs"
                            disabled={busy || !inventoryDelta[m.materialTypeId]}
                            onClick={() => applyInventoryAdjustment(t.id, m.materialTypeId)}
                          >
                            Apply
                          </WoodButton>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </PageFrame>
  );
}
