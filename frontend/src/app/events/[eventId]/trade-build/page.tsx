"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { TeamNav } from "../team-nav";

// Section 7.5 Trade & Build screen. Trade desk: trades remaining,
// create/receive offer, registered trade status, trade history. Build
// desk: recipe cards, "can build now" filter, missing material list,
// construct. Constructed buildings / deeds / bonuses / base score at the
// bottom. Registering/completing a trade and voiding a building stay
// moderator-only actions (Section 7.5: "Use moderator approval for
// binding registered trades... support the moderator's real-world
// process") — this screen only ever proposes and constructs, it never
// shows those buttons.
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

  if (!overview) return <main style={{ padding: "2rem" }}>Loading…</main>;
  if (!overview.myTeam) return (
    <main style={{ padding: "2rem" }}>
      <TeamNav eventId={eventId} />
      <p>Join a team first.</p>
    </main>
  );

  const otherTeams = overview.teams.filter((t: any) => t.id !== overview.myTeam.id);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 1000 }}>
      <TeamNav eventId={eventId} />
      <h1>Trade & Build</h1>
      {message && <p style={{ color: "crimson" }}>{message}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
        <section>
          <h2>Trade desk — {overview.settings.tradeLimit - overview.myTeam.tradeCount} trades remaining</h2>
          {overview.myRole === "leader" ? (
            <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
              <select value={counterpartyTeamId} onChange={(e) => setCounterpartyTeamId(e.target.value)}>
                <option value="">Trade with…</option>
                {otherTeams.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {tradeLines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <select value={line.fromMe ? "me" : "them"} onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, fromMe: e.target.value === "me" } : l)))}>
                    <option value="me">I give</option>
                    <option value="them">They give</option>
                  </select>
                  <select value={line.materialTypeId} onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, materialTypeId: e.target.value } : l)))}>
                    <option value="">material…</option>
                    {bankStock.map((m: any) => (
                      <option key={m.materialTypeId} value={m.materialTypeId}>{m.materialName}</option>
                    ))}
                  </select>
                  <input type="number" style={{ width: 70 }} value={line.quantity} onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                </div>
              ))}
              <button onClick={() => setTradeLines((ls) => [...ls, { fromMe: true, materialTypeId: "", quantity: "" }])}>+ line</button>
              <button onClick={submitTrade} disabled={!counterpartyTeamId} style={{ marginLeft: 8 }}>Propose trade</button>
            </div>
          ) : (
            <p style={{ color: "#666" }}>Only your team leader can propose a trade.</p>
          )}

          <h3>History</h3>
          <ul>
            {myTrades.map((t) => (
              <li key={t.id}>
                #{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName} — <strong>{t.status}</strong>
                {t.binding ? " (pink slip)" : ""}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Build desk</h2>
          {recipes.map((r: any) => {
            const missing = r.requirements.filter((req: any) => (quantityByMaterial.get(req.materialTypeId) ?? 0) < req.requiredQuantity);
            const canBuild = missing.length === 0;
            return (
              <div key={r.id} style={{ border: "1px solid #ccc", borderRadius: 8, padding: "0.75rem", marginBottom: "0.5rem", opacity: canBuild ? 1 : 0.6 }}>
                <strong>{r.name}</strong> — {r.basePoints} pts
                <ul style={{ fontSize: "0.85rem" }}>
                  {r.requirements.map((req: any) => (
                    <li key={req.materialTypeId} style={{ color: (quantityByMaterial.get(req.materialTypeId) ?? 0) < req.requiredQuantity ? "crimson" : "inherit" }}>
                      {req.materialName}: {quantityByMaterial.get(req.materialTypeId) ?? 0} / {req.requiredQuantity}
                    </li>
                  ))}
                </ul>
                {canBuild && (overview.myRole === "leader" || overview.isStaff) && (
                  <div>
                    <button onClick={() => construct(r.id, {})}>Construct</button>
                    <button onClick={() => construct(r.id, { eco: true })} style={{ marginLeft: 4 }}>+ Eco (4 Solar)</button>
                    <button onClick={() => construct(r.id, { landmark: true })} style={{ marginLeft: 4 }}>+ Landmark (1 Blueprint)</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <section style={{ marginTop: "2rem" }}>
        <h2>Your buildings</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={{ textAlign: "left" }}>Deed</th><th style={{ textAlign: "left" }}>Building</th><th style={{ textAlign: "right" }}>Points</th><th>Status</th></tr>
          </thead>
          <tbody>
            {myBuildings.map((b) => (
              <tr key={b.id}>
                <td>{b.deedNumber}</td>
                <td>{b.recipeName}</td>
                <td style={{ textAlign: "right" }}>{b.basePoints + b.ecoBonus + b.luxuryBonus + b.landmarkBonus}</td>
                <td>{b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
