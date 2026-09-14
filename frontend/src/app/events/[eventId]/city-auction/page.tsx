"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, StatTile, WoodButton } from "@/components/theme/Panel";

// Section 7.6 City Auction screen: city cards (tier/opening bid, hidden
// multiplier placeholder), wallet/balance, scout-report purchase (own
// team's private clue only), current auction bid entry, owned-city state.
export default function CityAuctionPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [auctions, setAuctions] = useState<any[]>([]);
  const [scoutReports, setScoutReports] = useState<any[]>([]);
  const [bidAmount, setBidAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // Independent requests fired together — see the same note on the
      // Trade & Build screen's refresh().
      const [ov, c, a] = await Promise.all([
        fetchJson<any>(`/api/events/${eventId}/overview`),
        fetchJson<any>(`/api/events/${eventId}/cities`),
        fetchJson<any>(`/api/events/${eventId}/city-auctions/list`),
      ]);
      setOverview(ov);
      setCities(c.cities);
      setAuctions(a.auctions);
      if (ov.myTeam) {
        const sr = await fetchJson<any>(`/api/events/${eventId}/teams/${ov.myTeam.id}/scout-reports`);
        setScoutReports(sr.reports);
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

  // Without this tick, the city auction countdown only moved when a
  // WebSocket broadcast happened to trigger a re-render (someone else
  // bidding) — same fix as the Stage 1 auction screen.
  const liveAuctionId = auctions.find((a) => a.status === "live")?.id;
  useEffect(() => {
    if (!liveAuctionId) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveAuctionId]);

  async function bid(auctionId: string) {
    if (!overview?.myTeam || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/city-auctions/${auctionId}/bids`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: overview.myTeam.id, amount: Number(bidAmount) }),
      });
      const body = await res.json();
      if (!res.ok) setMessage(body.message);
      else {
        setBidAmount("");
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function scout(cityId: string) {
    if (!overview?.myTeam || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/scout-reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: overview.myTeam.id, cityId }),
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

  const myCity = cities.find((c) => c.assignedTeamId === overview.myTeam?.id);
  const liveAuction = auctions.find((a) => a.status === "live");
  const scoutReportByCity = new Map(scoutReports.map((r) => [r.cityId, r]));
  const secondsLeft = liveAuction?.closesAt ? Math.max(0, Math.round((new Date(liveAuction.closesAt).getTime() - now) / 1000)) : 0;
  const timerExpired = Boolean(liveAuction?.closesAt) && secondsLeft <= 0;

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>CITY AUCTION</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}
      {message && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{message}</p>}

      {overview.myTeam && (
        <div className="grid grid-cols-3 gap-3 w-full max-w-lg mb-4">
          <StatTile label="Wallet" value={overview.myTeam.cityWalletTokens} />
          <StatTile label="Leftover" value={overview.myTeam.auctionTokens} />
          <StatTile label="Your city" value={myCity ? myCity.name : "—"} />
        </div>
      )}

      {liveAuction && (
        <Panel className="w-full max-w-2xl mb-6 border-2 border-[#F1EBB5]/40">
          <PanelTitle>
            LIVE: {liveAuction.city?.name} ({liveAuction.city?.tier})
          </PanelTitle>
          <p className="text-white mb-2">
            Opening bid: ₹{liveAuction.openingBid} · Current highest:{" "}
            {liveAuction.currentHighestBid ? `₹${liveAuction.currentHighestBid.amount} (${liveAuction.currentHighestBid.teamName})` : "none"}
          </p>
          {liveAuction.closesAt && (
            <p className={`mb-2 font-bold ${secondsLeft <= 10 ? "text-red-400" : "text-yellow-300"}`}>
              ⏱ {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
            </p>
          )}
          {overview.myRole === "leader" && !myCity && !timerExpired ? (
            <div className="flex gap-2">
              <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} className="px-3 py-2 rounded text-black flex-1" />
              <WoodButton variant="primary" onClick={() => bid(liveAuction.id)} disabled={busy || !bidAmount}>Bid</WoodButton>
            </div>
          ) : timerExpired && overview.myRole === "leader" && !myCity ? (
            <p className="text-[#F1EBB5]">This auction's timer has run out — waiting for the moderator to close it.</p>
          ) : myCity ? (
            <p className="text-[#F1EBB5]">You already won a city — you can't bid again.</p>
          ) : null}
        </Panel>
      )}

      <Panel className="w-full">
        <PanelTitle>CITIES</PanelTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cities.map((c) => (
            <div key={c.id} className="bg-[#764A21]/40 rounded-lg p-3 text-white">
              <div className="flex justify-between font-bold">
                <span>{c.name}</span>
                <span className="uppercase text-xs bg-black/30 px-2 py-0.5 rounded">{c.tier}</span>
              </div>
              <p className="text-sm text-white/80">Opening bid: ₹{c.openingBid}</p>
              <p className="text-sm">{c.assignedTeamId ? "sold" : "available"}</p>
              {scoutReportByCity.has(c.id) ? (
                <p className="text-yellow-300 text-sm mt-1">
                  {scoutReportByCity.get(c.id).clueType === "minimum_multiplier" ? "≥" : "<"} {scoutReportByCity.get(c.id).clueValue}x
                </p>
              ) : overview.myRole === "leader" && overview.settings.scoutReportsEnabled && !c.assignedTeamId ? (
                <WoodButton className="mt-2 text-xs px-2 py-1" disabled={busy} onClick={() => scout(c.id)}>
                  Scout ({overview.settings.scoutReportCost})
                </WoodButton>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </PageFrame>
  );
}
