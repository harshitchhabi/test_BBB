"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
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
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/trades/list`);
    if (res.ok) setTrades((await res.json()).trades);
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

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>TRADE DESK</HeaderBanner>
      {message && <p className="text-red-300 mb-3">{message}</p>}

      <Panel className="w-full">
        <div className="space-y-2">
          {trades.map((t) => (
            <div key={t.id} className="bg-[#764A21]/40 rounded-lg p-3 text-white">
              <div className="flex justify-between font-bold">
                <span>#{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName}</span>
                <span>{t.status}{t.binding ? " (pink slip)" : ""}</span>
              </div>
              <div className="text-sm text-white/80 mt-1">
                {t.lines.map((l: any, i: number) => (
                  <div key={i}>{l.fromTeamName} gives {l.quantity} {l.material?.name}</div>
                ))}
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {t.status === "submitted" && (
                  <>
                    <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/register`)}>Register</WoodButton>
                    <WoodButton variant="danger" disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/reject`, { reason: "Rejected by moderator." })}>Reject</WoodButton>
                  </>
                )}
                {t.status === "registered" && (
                  <WoodButton variant="primary" disabled={busy} onClick={() => call(`/api/events/${eventId}/trades/${t.id}/complete`)}>Complete</WoodButton>
                )}
                {(t.status === "submitted" || t.status === "registered") && (
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
