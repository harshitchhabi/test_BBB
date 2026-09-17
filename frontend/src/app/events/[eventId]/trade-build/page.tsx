"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { fetchEventOverviewFresh } from "@/lib/use-event-overview";
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
  const [allBuildings, setAllBuildings] = useState<any[]>([]);
  const [inspectTargetId, setInspectTargetId] = useState("");
  // Keyed by recipe id - the engine's constructBuilding already accepts
  // any combination of eco/landmark/luxury on one construction (they're
  // independent checks, not mutually exclusive), but the UI only ever
  // sent one bonus flag at a time, one button per bonus - so a team had
  // no way to actually claim more than one bonus on the same building
  // even though the server fully supports it.
  const [bonusSelections, setBonusSelections] = useState<Record<string, { eco?: boolean; landmark?: boolean; luxury?: boolean; luxuryMaterialKey?: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Every action on this page shares the single `busy` state, but a
  // React state read is stale relative to the click event that triggers
  // it - two clicks close enough together (a fast double-click, or
  // Enter held on a focused button) can both invoke a handler while
  // `busy` still reads false in both closures, before either render has
  // committed the disabled attribute. A ref is read fresh on every
  // call regardless of render timing - real risk here since these
  // actions spend tokens, consume finite materials, or count against a
  // limited number of trades/inspections.
  const busyRef = useRef(false);

  // Sentinel value, never a real team id - selecting it posts an OPEN
  // OFFER instead of a direct proposal (see submitTrade below).
  const OPEN_OFFER = "__open__";
  // Sentinel value, never a real material id - selecting it makes a
  // line trade TOKENS instead of a material ("credits for materials and
  // vice versa" per the rulebook's leftover-tokens-are-spendable-
  // anywhere model). Resolved to materialTypeId: null before submitting.
  const TOKENS = "__tokens__";
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
      const [ov, materials, rec, tr, ti, ab] = await Promise.all([
        fetchEventOverviewFresh(eventId) as Promise<any>,
        fetchJson<any>(`/api/events/${eventId}/bank-stock`),
        fetchJson<any>(`/api/events/${eventId}/recipes`),
        fetchJson<any>(`/api/events/${eventId}/trades/list`),
        fetchJson<any>(`/api/events/${eventId}/teams-inventory`),
        fetchJson<any>(`/api/events/${eventId}/buildings/list`),
      ]);
      setOverview(ov);
      setBankStock(materials.stock);
      setRecipes(rec.recipes);
      setMyTrades(tr.trades);
      setTeamsInventory(ti.teams);
      setAllBuildings(ab.buildings);
      if (ov.myTeam) {
        const inv = await fetchJson<any>(`/api/events/${eventId}/teams/${ov.myTeam.id}/inventory`);
        setInventory(inv.inventory);
        setMyBuildings(ab.buildings.filter((b: any) => b.teamId === ov.myTeam.id));
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

  // A line only counts as complete when it has a material chosen and a
  // genuinely valid positive whole-number quantity - a blank or partial
  // line (still on "material…", or an empty/non-numeric quantity field)
  // used to just get silently dropped by submitTrade's filter, which
  // meant clicking "Propose trade" with only an incomplete line filled
  // in submitted an EMPTY lines array with no client-side warning at
  // all - the confusing generic 400 ("proposerTeamId, counterpartyTeamId,
  // and valid lines... are required") was the very first sign anything
  // was wrong. Now surfaced before it ever reaches the server.
  const isOpenOfferSelected = counterpartyTeamId === OPEN_OFFER;
  // How much of a line's material the relevant side actually holds -
  // used both as a display hint and, for a line I'M giving, as a hard
  // cap: a team should never be able to propose giving more of
  // something than they currently have, since that's a promise they
  // could never actually keep.
  function heldFor(line: { fromMe: boolean; materialTypeId: string }): number | null {
    if (!line.materialTypeId) return null;
    if (line.materialTypeId === TOKENS) {
      // Only ever cap against OUR OWN token balance - another team's
      // token balance is private (same reasoning as its material
      // inventory being the only thing shared), so a line where THEY
      // give tokens is trusted to the server, uncapped here.
      return line.fromMe ? (overview.myTeam?.auctionTokens ?? 0) : null;
    }
    if (line.fromMe) return inventory.find((m: any) => m.materialTypeId === line.materialTypeId)?.quantity ?? 0;
    if (isOpenOfferSelected) return null; // "they" aren't a known team yet - nothing to cap against
    return counterpartyInventory?.materials.find((m: any) => m.materialTypeId === line.materialTypeId)?.quantity ?? 0;
  }
  function isCompleteLine(l: { fromMe: boolean; materialTypeId: string; quantity: string }) {
    if (!l.materialTypeId) return false;
    const n = Number(l.quantity);
    if (l.quantity.trim() === "" || !Number.isInteger(n) || n <= 0) return false;
    if (l.fromMe) {
      const held = heldFor(l);
      if (held != null && n > held) return false; // can't give more than we actually have
    }
    return true;
  }
  const completeLines = tradeLines.filter(isCompleteLine);
  const hasIncompleteLine = tradeLines.some((l) => (l.materialTypeId || l.quantity) && !isCompleteLine(l));
  const hasOverQuantityLine = tradeLines.some((l) => {
    if (!l.fromMe || !l.materialTypeId || !l.quantity.trim()) return false;
    const held = heldFor(l);
    return held != null && Number(l.quantity) > held;
  });

  async function submitTrade() {
    if (!overview?.myTeam || busyRef.current) return;
    if (!counterpartyTeamId) {
      setMessage("Choose who to trade with, or post an open offer, before proposing a trade.");
      return;
    }
    if (completeLines.length === 0) {
      setMessage("Add at least one complete line (material + a positive whole-number quantity, no more than your team currently holds for anything you're giving) before proposing a trade.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const lines = completeLines.map((l) => ({
        fromTeamId: l.fromMe ? overview.myTeam.id : isOpenOfferSelected ? null : counterpartyTeamId,
        materialTypeId: l.materialTypeId === TOKENS ? null : l.materialTypeId,
        quantity: Number(l.quantity),
      }));
      const res = await fetch(`/api/events/${eventId}/trades`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposerTeamId: overview.myTeam.id, counterpartyTeamId: isOpenOfferSelected ? null : counterpartyTeamId, lines }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
      else setTradeLines([{ fromMe: true, materialTypeId: "", quantity: "" }]);
      // Refresh either way - a rejected proposal can mean the trade
      // limit or counterparty state changed since this screen last
      // loaded.
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // acceptingTeamId is only needed for an open offer (no fixed
  // counterparty) - any team but the proposer may claim it.
  async function acceptOpenOffer(tradeId: string) {
    if (!overview?.myTeam || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/trades/${tradeId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acceptingTeamId: overview.myTeam.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function respondToTrade(tradeId: string, action: "accept" | "decline") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/trades/${tradeId}/${action}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
      // Refresh either way: the other team may have just withdrawn or a
      // moderator may have already cancelled this exact trade - reload
      // so a dead accept/decline button doesn't linger.
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function construct(recipeId: string, bonuses: { eco?: boolean; landmark?: boolean; luxury?: boolean; luxuryMaterialKey?: string }) {
    if (!overview?.myTeam || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/buildings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: overview.myTeam.id, recipeId, bonuses }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Section 7.6: any team can challenge another team's claimed building
  // by paying the inspection fee; if it fails, the building is voided.
  // This had a real, silent gap: requestInspection (the engine function)
  // and its route existed with no caller anywhere in the frontend, and
  // buildings/list additionally hard-forced non-staff callers to only
  // ever see their OWN team's buildings - so even a team that somehow
  // knew about this feature had no way to see what to challenge. Both
  // fixed together: the list route now shares buildings across teams
  // the same way materials/trades already do, and this is the missing
  // UI to actually use it.
  async function requestInspection() {
    if (!overview?.myTeam || busyRef.current || !inspectTargetId) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/inspections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengerTeamId: overview.myTeam.id, targetBuildingId: inspectTargetId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.message ?? `Something went wrong (${res.status}). Please try again.`);
      else setInspectTargetId("");
      await refresh();
    } finally {
      busyRef.current = false;
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
  // Open = still in progress (not yet completed/cancelled/rejected) -
  // the event-wide list is meant to show what's actually happening
  // right now, not accumulate every trade ever made as history clutter.
  const OPEN_TRADE_STATUSES = ["submitted", "accepted", "registered"];
  const openTrades = myTrades.filter((t: any) => OPEN_TRADE_STATUSES.includes(t.status));
  // Trading (propose/accept/decline) is server-enforced to Stage 2 only
  // (trade-service.ts's proposeTrade) - gating the form here too means a
  // team sees why up front instead of filling it out and only finding
  // out on submit. The Build Desk below is deliberately NOT gated the
  // same way: recipes are shown from the very start so a team knows what
  // to bid on materials for during Stage 1, even though constructBuilding
  // itself still only runs during Stage 2.
  const tradingOpen = overview.event.status === "stage_2";

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>TRADE & BUILD</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        <Panel>
          <PanelTitle>TRADE DESK - {overview.settings.tradeLimit - overview.myTeam.tradeCount} REMAINING</PanelTitle>
          {!tradingOpen && (
            <p className="text-yellow-300 text-sm mb-4">
              Trading is only open during Stage 2 - you can browse what's happening here, but proposing, accepting,
              or declining a trade will open up once Stage 2 begins.
            </p>
          )}
          {tradingOpen && overview.myRole === "leader" ? (
            <div className="bg-[#764A21]/40 rounded-lg p-4 mb-4">
              <select value={counterpartyTeamId} onChange={(e) => setCounterpartyTeamId(e.target.value)} className="w-full mb-2 px-2 py-1 rounded text-black">
                <option value="">Trade with…</option>
                <option value={OPEN_OFFER}>Open to anyone (any team may accept)</option>
                {otherTeams.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {counterpartyTeamId && !isOpenOfferSelected && (
                <div className="bg-black/30 rounded p-2 mb-2 text-xs text-white/90">
                  <span className="text-yellow-300 font-semibold">{counterpartyInventory?.teamName ?? "This team"}'s materials: </span>
                  {counterpartyInventory && counterpartyInventory.materials.length > 0
                    ? counterpartyInventory.materials.map((m: any) => `${m.materialName} ${m.quantity}`).join(", ")
                    : "none yet"}
                </div>
              )}
              {isOpenOfferSelected && (
                <p className="text-white/70 text-xs mb-2">
                  &quot;They give&quot; lines below mean &quot;whoever accepts this offer must provide it&quot; - not tied to any
                  specific team&apos;s current materials yet.
                </p>
              )}
              {tradeLines.map((line, i) => {
                const held = heldFor(line);
                return (
                  <div key={i} className="flex gap-1 mt-2 items-center">
                    <select
                      value={line.fromMe ? "me" : "them"}
                      onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, fromMe: e.target.value === "me" } : l)))}
                      className="rounded px-1 text-black text-sm"
                    >
                      <option value="me">I give</option>
                      <option value="them">{isOpenOfferSelected ? "Whoever accepts gives" : "They give"}</option>
                    </select>
                    <select
                      value={line.materialTypeId}
                      onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, materialTypeId: e.target.value } : l)))}
                      className="rounded px-1 text-black text-sm flex-1"
                    >
                      <option value="">material…</option>
                      <option value={TOKENS}>Tokens (credits)</option>
                      {bankStock.map((m: any) => (
                        <option key={m.materialTypeId} value={m.materialTypeId}>{m.materialName}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={line.fromMe && held != null ? held : undefined}
                      className="w-16 rounded px-1 text-black text-sm"
                      placeholder={held != null ? `qty (has ${held})` : "qty"}
                      value={line.quantity}
                      onChange={(e) => setTradeLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
                    />
                    {tradeLines.length > 1 && (
                      <WoodButton
                        variant="danger"
                        className="px-2 py-1 text-xs"
                        onClick={() => setTradeLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        Remove
                      </WoodButton>
                    )}
                  </div>
                );
              })}
              <div className="flex gap-2 mt-3">
                <WoodButton onClick={() => setTradeLines((ls) => [...ls, { fromMe: true, materialTypeId: "", quantity: "" }])}>+ line</WoodButton>
                <WoodButton variant="primary" onClick={submitTrade} disabled={busy || !counterpartyTeamId || completeLines.length === 0}>
                  Propose trade
                </WoodButton>
              </div>
              {hasIncompleteLine && !hasOverQuantityLine && (
                <p className="text-yellow-300 text-xs mt-2">One or more lines are incomplete and won't be included - pick a material and a quantity for each line you want to submit.</p>
              )}
              {hasOverQuantityLine && (
                <p className="text-orange-300 text-xs mt-2 font-semibold">
                  One of your &quot;I give&quot; lines asks for more than your team currently holds - lower the quantity to at
                  most what you have, or that line won&apos;t be included.
                </p>
              )}
            </div>
          ) : (
            tradingOpen && <p className="text-[#F1EBB5] mb-4">Only your team leader can propose a trade.</p>
          )}

          {pendingTrades.length > 0 && overview.myRole === "leader" && (
            <div className="mb-4">
              <h3 className="text-yellow-300 font-bold mb-2">Waiting on a response</h3>
              <div className="space-y-2">
                {pendingTrades.map((t: any) => {
                  const isCounterparty = t.counterpartyTeamId === overview.myTeam.id;
                  const isMyOpenOffer = !t.counterpartyTeamId && t.proposerTeamId === overview.myTeam.id;
                  return (
                    <div key={t.id} className="bg-[#764A21]/40 rounded-lg p-3 text-sm text-white">
                      <div className="font-bold">
                        #{t.tradeNumber}: {t.proposerTeamName} ↔ {isMyOpenOffer ? "open to anyone" : t.counterpartyTeamName}
                      </div>
                      <div className="text-white/80 mt-1">
                        {t.lines.map((l: any, i: number) => (
                          <div key={i}>{l.fromTeamName ?? "Whoever accepts"} gives {l.quantity} {l.material?.name ?? "tokens"}</div>
                        ))}
                      </div>
                      {isCounterparty ? (
                        <div className="flex gap-2 mt-2">
                          <WoodButton variant="primary" disabled={busy} onClick={() => respondToTrade(t.id, "accept")}>Accept</WoodButton>
                          <WoodButton variant="danger" disabled={busy} onClick={() => respondToTrade(t.id, "decline")}>Decline</WoodButton>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-yellow-300">
                            {isMyOpenOffer ? "Waiting for any team to accept." : `Waiting for ${t.counterpartyTeamName} to respond.`}
                          </span>
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
              <p className="text-white/60 text-xs mb-2">
                A genuinely open offer (no fixed counterparty yet) can be accepted by any team here - a direct
                proposal between two other teams is shown read-only, since only those two can act on it.
              </p>
              <div className="space-y-2">
                {otherPendingTrades.map((t: any) => {
                  const isOpen = !t.counterpartyTeamId;
                  return (
                    <div key={t.id} className="bg-[#764A21]/25 rounded-lg p-3 text-sm text-white">
                      <div className="font-bold">
                        #{t.tradeNumber}: {t.proposerTeamName} ↔ {isOpen ? "open to anyone" : t.counterpartyTeamName}
                      </div>
                      <div className="text-white/70 mt-1">
                        {t.lines.map((l: any, i: number) => (
                          <div key={i}>{l.fromTeamName ?? "Whoever accepts"} gives {l.quantity} {l.material?.name ?? "tokens"}</div>
                        ))}
                      </div>
                      {isOpen && overview.myRole === "leader" && (
                        <WoodButton variant="primary" className="mt-2" disabled={busy} onClick={() => acceptOpenOffer(t.id)}>
                          Accept this offer
                        </WoodButton>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <h3 className="text-yellow-300 font-bold mb-2">Open trades in this event</h3>
          <div className="space-y-1">
            {openTrades.length === 0 && <p className="text-white/50 text-sm">No open trades right now.</p>}
            {openTrades.map((t: any) => (
              <div key={t.id} className="bg-[#764A21]/40 rounded px-3 py-2 text-sm text-white">
                #{t.tradeNumber}: {t.proposerTeamName} ↔ {t.counterpartyTeamName ?? "open to anyone"} - <strong>{t.status}</strong>
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
                  {canBuild && (overview.myRole === "leader" || overview.isStaff) && (() => {
                    const sel = bonusSelections[r.id] ?? {};
                    const setSel = (patch: Partial<typeof sel>) => setBonusSelections((s) => ({ ...s, [r.id]: { ...sel, ...patch } }));
                    const luxuryEligible = ["mall", "university", "office"].includes(r.key);
                    return (
                      <div className="mt-2">
                        <div className="flex gap-3 flex-wrap text-xs text-white/90 mb-2">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={Boolean(sel.eco)} onChange={(e) => setSel({ eco: e.target.checked })} />
                            Eco (+4 Solar)
                          </label>
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={Boolean(sel.landmark)} onChange={(e) => setSel({ landmark: e.target.checked })} />
                            Landmark (+1 Blueprint)
                          </label>
                          {luxuryEligible && (
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={Boolean(sel.luxury)}
                                onChange={(e) => setSel({ luxury: e.target.checked, luxuryMaterialKey: sel.luxuryMaterialKey ?? "marble" })}
                              />
                              Luxury (+1
                              <select
                                value={sel.luxuryMaterialKey ?? "marble"}
                                onChange={(e) => setSel({ luxuryMaterialKey: e.target.value })}
                                className="text-black rounded px-1"
                                disabled={!sel.luxury}
                              >
                                <option value="marble">Marble</option>
                                <option value="tiles">Tiles</option>
                              </select>
                              )
                            </label>
                          )}
                        </div>
                        <WoodButton
                          variant="primary"
                          disabled={busy}
                          onClick={() => construct(r.id, { eco: sel.eco, landmark: sel.landmark, luxury: sel.luxury, luxuryMaterialKey: sel.luxury ? sel.luxuryMaterialKey ?? "marble" : undefined })}
                        >
                          Construct{sel.eco || sel.landmark || sel.luxury ? " with bonuses" : ""}
                        </WoodButton>
                      </div>
                    );
                  })()}
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

      {overview.settings.inspectionsEnabled && (
        <Panel className="w-full mt-4 border-2 border-red-800">
          <PanelTitle>
            CHALLENGE A BUILDING (INSPECTION) - {overview.settings.inspectionLimitPerTeam - (overview.myTeam.inspectionCount ?? 0)} REMAINING
          </PanelTitle>
          <p className="text-white/70 text-sm mb-3">
            Pay {overview.settings.inspectionCost} tokens to challenge another team's claimed building. If it fails
            inspection, it's voided and its materials return to the bank; either way, the fee is not refunded.
          </p>
          {overview.myRole === "leader" ? (
            <div className="flex gap-2 flex-wrap">
              <select value={inspectTargetId} onChange={(e) => setInspectTargetId(e.target.value)} className="flex-1 min-w-48 px-3 py-2 rounded text-black">
                <option value="">Choose a building to challenge…</option>
                {allBuildings
                  .filter((b: any) => b.teamId !== overview.myTeam.id && b.status !== "voided")
                  .map((b: any) => (
                    <option key={b.id} value={b.id}>{b.teamName} - {b.deedNumber} ({b.recipeName})</option>
                  ))}
              </select>
              <WoodButton
                variant="danger"
                disabled={busy || !inspectTargetId || (overview.myTeam.inspectionCount ?? 0) >= overview.settings.inspectionLimitPerTeam}
                onClick={requestInspection}
              >
                Request inspection
              </WoodButton>
            </div>
          ) : (
            <p className="text-[#F1EBB5] text-sm">Only your team leader can request an inspection.</p>
          )}
        </Panel>
      )}
    </PageFrame>
  );
}
