"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { TeamNav } from "../team-nav";

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

  if (!overview) return <main style={{ padding: "2rem" }}>Loading…</main>;

  const myCity = cities.find((c) => c.assignedTeamId === overview.myTeam?.id);
  const liveAuction = auctions.find((a) => a.status === "live");
  const scoutReportByCity = new Map(scoutReports.map((r) => [r.cityId, r]));

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 900 }}>
      <TeamNav eventId={eventId} />
      <h1>City Auction</h1>
      {message && <p style={{ color: "crimson" }}>{message}</p>}

      {overview.myTeam && (
        <p>
          Wallet: <strong>{overview.myTeam.cityWalletTokens}</strong> · Leftover: <strong>{overview.myTeam.auctionTokens}</strong>
          {myCity && <> · Your city: <strong>{myCity.name}</strong> ({myCity.tier})</>}
        </p>
      )}

      {liveAuction && (
        <section style={{ border: "2px solid #444", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
          <h2>Live: {liveAuction.city?.name} ({liveAuction.city?.tier})</h2>
          <p>Opening bid: {liveAuction.openingBid} · Current highest: {liveAuction.currentHighestBid ? `${liveAuction.currentHighestBid.amount} (${liveAuction.currentHighestBid.teamName})` : "none"}</p>
          {overview.myRole === "leader" && !myCity && (
            <div>
              <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} />
              <button onClick={() => bid(liveAuction.id)} disabled={!bidAmount}>Bid</button>
            </div>
          )}
          {myCity && <p style={{ color: "#666" }}>You already won a city — you can't bid again.</p>}
        </section>
      )}

      <h2>Cities</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ textAlign: "left" }}>City</th><th>Tier</th><th style={{ textAlign: "right" }}>Opening bid</th><th>Status</th><th>Scout</th></tr>
        </thead>
        <tbody>
          {cities.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td style={{ textAlign: "center" }}>{c.tier}</td>
              <td style={{ textAlign: "right" }}>{c.openingBid}</td>
              <td style={{ textAlign: "center" }}>{c.assignedTeamId ? "sold" : "available"}</td>
              <td>
                {scoutReportByCity.has(c.id) ? (
                  <span>{scoutReportByCity.get(c.id).clueType === "minimum_multiplier" ? "≥" : "<"} {scoutReportByCity.get(c.id).clueValue}x</span>
                ) : overview.myRole === "leader" && overview.settings.scoutReportsEnabled && !c.assignedTeamId ? (
                  <button onClick={() => scout(c.id)}>Scout ({overview.settings.scoutReportCost})</button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
