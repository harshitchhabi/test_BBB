"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, WoodButton } from "@/components/theme/Panel";

// Section 7.9 Trade desk controls: register, approve/reject, complete, or
// cancel trades.
export default function ModeratorTradesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [trades, setTrades] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/trades/list`);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setTrades(body.trades);
      setLoadError(null);
    } else {
      setLoadError(body?.message ?? `Couldn't load trades (${res.status}).`);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  async function call(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(json.message ?? `Error (${res.status})`);
      // Refresh either way: a rejected action here (e.g. trying to
      // register/complete a trade someone else just cancelled) almost
      // always means this screen's own view of a row is stale - reload
      // immediately instead of leaving a dead button with no self-
      // correction short of a manual page reload (same class of bug
      // found and fixed on the Stage 1 and Cities consoles).
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>TRADE DESK</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      <Panel className="w-full">
        {trades.length === 0 && <p className="text-white/70 text-center py-4">No trades proposed yet.</p>}
        <div className="space-y-2">
          {trades.map((t) => (
            <div key={t.id} className="bg-[#764A21]/40 rounded-lg p-3 text-white">
              <div className="flex justify-between font-bold">
                <span>#{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName ?? "open to anyone"}</span>
                <span className="capitalize">{t.status}{t.binding ? " (pink slip)" : ""}</span>
              </div>
              <div className="text-sm text-white/80 mt-1">
                {t.lines.map((l: any, i: number) => (
                  <div key={i}>{l.fromTeamName ?? "Whoever accepts"} gives {l.quantity} {l.material?.name}</div>
                ))}
              </div>
              {t.status === "submitted" && (
                <p className="text-yellow-300 text-sm mt-1">
                  {t.counterpartyTeamName ? `Waiting for ${t.counterpartyTeamName} to accept - nothing for you to do yet.` : "Open offer - waiting for any team to accept."}
                </p>
              )}
              <div className="flex gap-2 mt-2 flex-wrap">
                {t.status === "accepted" && (
                  <>
                    <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/register`)}>Register</WoodButton>
                    <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/reject`, { reason: "Rejected by moderator." })}>Reject</WoodButton>
                  </>
                )}
                {t.status === "registered" && (
                  <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/complete`)}>Complete</WoodButton>
                )}
                {(t.status === "submitted" || t.status === "accepted" || t.status === "registered") && (
                  <WoodButton disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/cancel`, { reason: "Cancelled by moderator." })}>Cancel</WoodButton>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </PageFrame>
  );
}
