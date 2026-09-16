"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.5 Trade & Build screen. Trade desk: trades remaining,
// create/receive offer, registered trade status, trade history. Build
// desk: recipe cards, "can build now" filter, missing material list,
// construct. Registering/completing a trade and voiding a building stay
// moderator-only actions — this screen only ever proposes and constructs.
export default function TradeBuildPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [myBuildings, setMyBuildings] = useState<any[]>([]);
  const [myTrades, setMyTrades] = useState<any[]>([]);
  const [bankStock, setBankStock] = useState<any[]>([]);
  const [teamsInventory, setTeamsInventory] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [counterpartyTeamId, setCounterpartyTeamId] = useState("");
  const [tradeLines, setTradeLines] = useState<Array<{ fromMe: boolean; materialTypeId: string; quantity: string }>>([
    { fromMe: true, materialTypeId: "", quantity: "" },
  ]);

  const refresh = useCallback(async () => {
    try {
      // These four don't depend on each other — firing them together
      // instead of one-at-a-time cuts this screen's refresh time to
      // roughly its slowest single request instead of the sum of all
      // four, which matters a lot given this refresh reruns on every
      // WebSocket broadcast (any team's bid, trade, or build).
      const [ov, materials, rec, tr, ti] = await Promise.all([
        fetchJson<any>(`/api/events/${eventId}/overview`),
        fetchJson<any>(`/api/events/${eventId}/bank-stock`),
        fetchJson<any>(`/api/events/${eventId}/recipes`),
        fetchJson<any>(`/api/events/${eventId}/trades/list`),
        fetchJson<any>(`/api/events/${eventId}/teams-inventory`),
      ]);
      setOverview(ov);
      setBankStock(materials.stock);
      setRecipes(rec.recipes);
      setMyTrades(tr.trades);
      setTeamsInventory(ti.teams);
      if (ov.myTeam) {
        const [inv, bld] = await Promise.all([
          fetchJson<any>(`/api/events/${eventId}/teams/${ov.myTeam.id}/inventory`),
          fetchJson<any>(`/api/events/${eventId}/buildings/list?teamId=${ov.myTeam.id}`),
        ]);
        setInventory(inv.inventory);
        setMyBuildings(bld.buildings);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof FetchJsonError ? err.message : "Couldn't load this page. Retrying…");
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  const quantityByMaterial = new Map(inventory.map((i) => [i.materialTypeId, i.quantity]));

  async function submitTrade() {
    if (!overview?.myTeam || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const lines = tradeLines
        .filter((l) => l.materialTypeId && l.quantity)
        .map((l) => ({ fromTeamId: l.fromMe ? overview.myTeam.id : counterpartyTeamId, materialTypeId: l.materialTypeId, quantity: Number(l.quantity) }));
      const res = await fetch(`/api/events/${eventId}/trades`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposerTeamId: overview.myTeam.id, counterpartyTeamId, lines }),
      });
      const body = await res.json();
      if (!res.ok) setMessage(body.message);
      else {
        setTradeLines([{ fromMe: true, materialTypeId: "", quantity: "" }]);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function respondToTrade(tradeId: string, action: "accept" | "decline") {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/trades/${tradeId}/${action}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) setMessage(body.message);
      else refresh();
    } finally {
      setBusy(false);
    }
  }

  async function construct(recipeId: string, bonuses: Record<string, boolean>) {
    if (!overview?.myTeam || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/buildings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: overview.myTeam.id, recipeId, bonuses }),
      });
      const body = await res.json();
      if (!res.ok) setMessage(body.message);
      else refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !overview) return <PageFrame><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  if (!overview.myTeam) {
    return (
      <PageFrame>
        <TeamNav eventId={eventId} />
        <p className="text-[#F1EBB5]">Join a team first.</p>
      </PageFrame>
    );
  }

  const otherTeams = overview.teams.filter((t: any) => t.id !== overview.myTeam.id);
  const counterpartyInventory = teamsInventory.find((t: any) => t.teamId === counterpartyTeamId);
  const isMyTrade = (t: any) => t.proposerTeamId === overview.myTeam.id || t.counterpartyTeamId === overview.myTeam.id;
  // myTrades is really "every trade in this event" now — trades/list
  // shows all of them to every team so a team can see what's being
  // negotiated around them, not just their own. Only the pending ones
  // actually involving my team are actionable (accept/decline/withdraw);
  // everyone else's pending offers are shown separately, read-only.
  const pendingTrades = myTrades.filter((t: any) => t.status === "submitted" && isMyTrade(t));
  const otherPendingTrades = myTrades.filter((t: any) => t.status === "submitted" && !isMyTrade(t));

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>TRADE & BUILD</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        <Panel>
          <PanelTitle>TRADE DESK - {overview.settings.tradeLimit - overview.myTeam.tradeCount} REMAINING</PanelTitle>
          {overview.myRole === "leader" ? (
            <div className="bg-[#764A21]/40 rounded-lg p-4 mb-4">
              <select value={counterpartyTeamId} onChange={(e) => setCounterpartyTeamId(e.target.value)} className="w-full mb-2 px-2 py-1 rounded text-black">
                <option value="">Trade with…</option>
                {otherTeams.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {counterpartyTeamId && (
                <div className="bg-black/30 rounded p-2 mb-2 text-xs text-white/90">
                  <span className="text-yellow-300 font-semibold">{counterpartyInventory?.teamName ?? "This team"}'s materials: </span>
                  {counterpartyInventory && counterpartyInventory.materials.length > 0
                    ? counterpartyInventory.materials.map((m: any) => `${m.materialName} ${m.quantity}`).join(", ")
                    : "none yet"}
                </div>
              )}
              {tradeLines.map((line, i) => (
                <div key={i} className="flex gap-1 mt-2">
                  <select
                    value={line.fromMe ? "me" : "them"}
                    onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, fromMe: e.target.value === "me" } : l)))}
                    className="rounded px-1 text-black text-sm"
                  >
                    <option value="me">I give</option>
                    <option value="them">They give</option>
                  </select>
                  <select
                    value={line.materialTypeId}
                    onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, materialTypeId: e.target.value } : l)))}
                    className="rounded px-1 text-black text-sm flex-1"
                  >
                    <option value="">material…</option>
                    {bankStock.map((m: any) => (
                      <option key={m.materialTypeId} value={m.materialTypeId}>{m.materialName}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="w-16 rounded px-1 text-black text-sm"
                    value={line.quantity}
                    onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
                  />
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <WoodButton onClick={() => setTradeLines((ls) => [...ls, { fromMe: true, materialTypeId: "", quantity: "" }])}>+ line</WoodButton>
                <WoodButton variant="primary" onClick={submitTrade} disabled={busy || !counterpartyTeamId}>Propose trade</WoodButton>
              </div>
            </div>
          ) : (
            <p className="text-[#F1EBB5] mb-4">Only your team leader can propose a trade.</p>
          )}

          {pendingTrades.length > 0 && overview.myRole === "leader" && (
            <div className="mb-4">
              <h3 className="text-yellow-300 font-bold mb-2">Waiting on a response</h3>
              <div className="space-y-2">
                {pendingTrades.map((t: any) => {
                  const isCounterparty = t.counterpartyTeamId === overview.myTeam.id;
                  return (
                    <div key={t.id} className="bg-[#764A21]/40 rounded-lg p-3 text-sm text-white">
                      <div className="font-bold">
                        #{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName}
                      </div>
                      <div className="text-white/80 mt-1">
                        {t.lines.map((l: any, i: number) => (
                          <div key={i}>{l.fromTeamName} gives {l.quantity} {l.material?.name}</div>
                        ))}
                      </div>
                      {isCounterparty ? (
                        <div className="flex gap-2 mt-2">
                          <WoodButton variant="primary" disabled={busy} onClick={() => respondToTrade(t.id, "accept")}>Accept</WoodButton>
                          <WoodButton variant="danger" disabled={busy} onClick={() => respondToTrade(t.id, "decline")}>Decline</WoodButton>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-yellow-300">Waiting for {t.counterpartyTeamName} to respond.</span>
                          <WoodButton disabled={busy} onClick={() => respondToTrade(t.id, "decline")}>Withdraw offer</WoodButton>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {otherPendingTrades.length > 0 && (
            <div className="mb-4">
              <h3 className="text-yellow-300 font-bold mb-2">Other teams' open offers</h3>
              <p className="text-white/60 text-xs mb-2">Visible to everyone - only the two teams involved can accept, decline, or withdraw.</p>
              <div className="space-y-2">
                {otherPendingTrades.map((t: any) => (
                  <div key={t.id} className="bg-[#764A21]/25 rounded-lg p-3 text-sm text-white">
                    <div className="font-bold">
                      #{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName}
                    </div>
                    <div className="text-white/70 mt-1">
                      {t.lines.map((l: any, i: number) => (
                        <div key={i}>{l.fromTeamName} gives {l.quantity} {l.material?.name}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h3 className="text-yellow-300 font-bold mb-2">All trades in this event</h3>
          <div className="space-y-1">
            {myTrades.map((t) => (
              <div key={t.id} className="bg-[#764A21]/40 rounded px-3 py-2 text-sm text-white">
                #{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName} - <strong>{t.status}</strong>
                {t.binding ? " (pink slip)" : ""}
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelTitle>BUILD DESK</PanelTitle>
          <div className="space-y-2">
            {recipes.map((r: any) => {
              const missing = r.requirements.filter((req: any) => (quantityByMaterial.get(req.materialTypeId) ?? 0) < req.requiredQuantity);
              const canBuild = missing.length === 0;
              return (
                <div key={r.id} className={`bg-[#764A21]/40 rounded-lg p-3 ${canBuild ? "" : "opacity-60"}`}>
                  <div className="flex justify-between text-white">
                    <strong>{r.name}</strong>
                    <span>{r.basePoints} pts</span>
                  </div>
                  <ul className="text-xs mt-1">
                    {r.requirements.map((req: any) => (
                      <li key={req.materialTypeId} className={(quantityByMaterial.get(req.materialTypeId) ?? 0) < req.requiredQuantity ? "text-orange-300 font-semibold" : "text-yellow-200"}>
                        {req.materialName}: {quantityByMaterial.get(req.materialTypeId) ?? 0} / {req.requiredQuantity}
                      </li>
                    ))}
                  </ul>
                  {canBuild && (overview.myRole === "leader" || overview.isStaff) && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <WoodButton variant="primary" disabled={busy} onClick={() => construct(r.id, {})}>Construct</WoodButton>
                      <WoodButton disabled={busy} onClick={() => construct(r.id, { eco: true })}>+ Eco</WoodButton>
                      <WoodButton disabled={busy} onClick={() => construct(r.id, { landmark: true })}>+ Landmark</WoodButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel className="w-full mt-4">
        <PanelTitle>ALL TEAMS' MATERIALS</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          What every team currently holds - token balances and scores stay private, but materials are shared so you
          can actually see what's worth proposing a trade for.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-white text-sm">
            <tbody>
              {teamsInventory.map((t: any) => (
                <tr key={t.teamId} className="odd:bg-[#764A21]/30 align-top">
                  <td className="pr-4 py-2 font-bold whitespace-nowrap">
                    {t.teamName}
                    {t.teamId === overview.myTeam.id ? " (you)" : ""}
                  </td>
                  <td className="py-2">
                    {t.materials.length > 0
                      ? t.materials.map((m: any) => `${m.materialName} ${m.quantity}`).join(", ")
                      : <span className="text-white/50">none yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="w-full mt-4">
        <PanelTitle>YOUR BUILDINGS</PanelTitle>
        <div className="space-y-1">
          {myBuildings.map((b) => (
            <div key={b.id} className="bg-[#764A21]/40 rounded px-3 py-2 flex justify-between text-white text-sm">
              <span>{b.deedNumber} - {b.recipeName}</span>
              <span>{b.basePoints + b.ecoBonus + b.luxuryBonus + b.landmarkBonus} pts ({b.status})</span>
            </div>
          ))}
        </div>
      </Panel>
    </PageFrame>
  );
}
