"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, WoodButton } from "@/components/theme/Panel";

// Section 7.9 "Teams & Balances" + "Incidents" (team withdrawal, balance
// adjustment, manual correction) combined into one screen.
export default function ModeratorTeamsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
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

  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>TEAMS & INCIDENTS</HeaderBanner>
      {message && <p className="text-red-300 mb-3">{message}</p>}

      <Panel className="w-full">
        <div className="space-y-2">
          {overview.teams.map((t: any) => (
            <div key={t.id} className="bg-[#764A21]/40 rounded-lg p-3 text-white flex flex-wrap gap-3 items-center justify-between">
              <div>
                <strong>{t.name}</strong> ({t.code}) — {t.status}
                <div className="text-sm text-white/80">
                  Tokens: {t.auctionTokens} · Wallet: {t.cityWalletTokens} · Trades: {t.tradeCount}
                </div>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  className="w-20 px-2 py-1 rounded text-black text-sm"
                  placeholder="±tokens"
                  value={adjustAmount[t.id] ?? ""}
                  onChange={(e) => setAdjustAmount((a) => ({ ...a, [t.id]: e.target.value }))}
                />
                <WoodButton
                  disabled={busy || !adjustAmount[t.id]}
                  onClick={() => call(`/api/events/${eventId}/teams/${t.id}/adjust-tokens`, { auctionTokensDelta: Number(adjustAmount[t.id]), reason: "Manual correction." })}
                >
                  Apply
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
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </PageFrame>
  );
}
