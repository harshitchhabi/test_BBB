"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
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
  const [message, setMessage] = useState<string | null>(null);

  const [counterpartyTeamId, setCounterpartyTeamId] = useState("");
  const [tradeLines, setTradeLines] = useState<Array<{ fromMe: boolean; materialTypeId: string; quantity: string }>>([
    { fromMe: true, materialTypeId: "", quantity: "" },
  ]);

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
    const materials = await fetch(`/api/events/${eventId}/bank-stock`).then((r) => r.json());
    setBankStock(materials.stock);
    const rec = await fetch(`/api/events/${eventId}/recipes`).then((r) => r.json());
    setRecipes(rec.recipes);
    const tr = await fetch(`/api/events/${eventId}/trades/list`).then((r) => r.json());
    setMyTrades(tr.trades);
    if (ov.myTeam) {
      const inv = await fetch(`/api/events/${eventId}/teams/${ov.myTeam.id}/inventory`).then((r) => r.json());
      setInventory(inv.inventory);
      const bld = await fetch(`/api/events/${eventId}/buildings/list?teamId=${ov.myTeam.id}`).then((r) => r.json());
      setMyBuildings(bld.buildings);
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
    if (!overview?.myTeam) return;
    setMessage(null);
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
  }

  async function construct(recipeId: string, bonuses: Record<string, boolean>) {
    if (!overview?.myTeam) return;
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/buildings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId: overview.myTeam.id, recipeId, bonuses }),
    });
    const body = await res.json();
    if (!res.ok) setMessage(body.message);
    else refresh();
  }

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

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>TRADE & BUILD</HeaderBanner>
      {message && <p className="text-red-300 mb-3">{message}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        <Panel>
          <PanelTitle>TRADE DESK — {overview.settings.tradeLimit - overview.myTeam.tradeCount} REMAINING</PanelTitle>
          {overview.myRole === "leader" ? (
            <div className="bg-[#764A21]/40 rounded-lg p-4 mb-4">
              <select value={counterpartyTeamId} onChange={(e) => setCounterpartyTeamId(e.target.value)} className="w-full mb-2 px-2 py-1 rounded text-black">
                <option value="">Trade with…</option>
                {otherTeams.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
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
                <WoodButton variant="primary" onClick={submitTrade} disabled={!counterpartyTeamId}>Propose trade</WoodButton>
              </div>
            </div>
          ) : (
            <p className="text-[#F1EBB5] mb-4">Only your team leader can propose a trade.</p>
          )}

          <h3 className="text-yellow-300 font-bold mb-2">History</h3>
          <div className="space-y-1">
            {myTrades.map((t) => (
              <div key={t.id} className="bg-[#764A21]/40 rounded px-3 py-2 text-sm text-white">
                #{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName} — <strong>{t.status}</strong>
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
                      <li key={req.materialTypeId} className={(quantityByMaterial.get(req.materialTypeId) ?? 0) < req.requiredQuantity ? "text-red-300" : "text-yellow-200"}>
                        {req.materialName}: {quantityByMaterial.get(req.materialTypeId) ?? 0} / {req.requiredQuantity}
                      </li>
                    ))}
                  </ul>
                  {canBuild && (overview.myRole === "leader" || overview.isStaff) && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <WoodButton variant="primary" onClick={() => construct(r.id, {})}>Construct</WoodButton>
                      <WoodButton onClick={() => construct(r.id, { eco: true })}>+ Eco</WoodButton>
                      <WoodButton onClick={() => construct(r.id, { landmark: true })}>+ Landmark</WoodButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel className="w-full mt-4">
        <PanelTitle>YOUR BUILDINGS</PanelTitle>
        <div className="space-y-1">
          {myBuildings.map((b) => (
            <div key={b.id} className="bg-[#764A21]/40 rounded px-3 py-2 flex justify-between text-white text-sm">
              <span>{b.deedNumber} — {b.recipeName}</span>
              <span>{b.basePoints + b.ecoBonus + b.luxuryBonus + b.landmarkBonus} pts ({b.status})</span>
            </div>
          ))}
        </div>
      </Panel>
    </PageFrame>
  );
}
