"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
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

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
    const c = await fetch(`/api/events/${eventId}/cities`).then((r) => r.json());
    setCities(c.cities);
    const a = await fetch(`/api/events/${eventId}/city-auctions/list`).then((r) => r.json());
    setAuctions(a.auctions);
    if (ov.myTeam) {
      const sr = await fetch(`/api/events/${eventId}/teams/${ov.myTeam.id}/scout-reports`).then((r) => r.json());
      setScoutReports(sr.reports);
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);
  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  async function bid(auctionId: string) {
    if (!overview?.myTeam) return;
    setMessage(null);
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
  }

  async function scout(cityId: string) {
    if (!overview?.myTeam) return;
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/scout-reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId: overview.myTeam.id, cityId }),
    });
    const body = await res.json();
    if (!res.ok) setMessage(body.message);
    else refresh();
  }

  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  const myCity = cities.find((c) => c.assignedTeamId === overview.myTeam?.id);
  const liveAuction = auctions.find((a) => a.status === "live");
  const scoutReportByCity = new Map(scoutReports.map((r) => [r.cityId, r]));

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner>CITY AUCTION</HeaderBanner>
      {message && <p className="text-red-300 mb-3">{message}</p>}

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
          {overview.myRole === "leader" && !myCity ? (
            <div className="flex gap-2">
              <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} className="px-3 py-2 rounded text-black flex-1" />
              <WoodButton variant="primary" onClick={() => bid(liveAuction.id)} disabled={!bidAmount}>Bid</WoodButton>
            </div>
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
                <WoodButton className="mt-2 text-xs px-2 py-1" onClick={() => scout(c.id)}>
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
