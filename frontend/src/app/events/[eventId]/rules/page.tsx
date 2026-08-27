"use client";

import { use, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { TeamNav } from "../team-nav";

// Section 7.1 "Rules" nav item — Section 3 gap assessment explicitly
// calls out replacing the legacy's *static* rules page: "Display the
// selected event settings and current stage." Every number below comes
// straight from this event's own event_settings row, never a hard-coded
// constant.
export default function RulesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);

  useEffect(() => {
    if (status === "authenticated") {
      fetch(`/api/events/${eventId}/overview`)
        .then((r) => r.json())
        .then(setOverview);
    }
  }, [eventId, status]);

  if (!overview) return <main style={{ padding: "2rem" }}>Loading…</main>;
  const s = overview.settings;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 800 }}>
      <TeamNav eventId={eventId} />
      <h1>Rules — {overview.event.name}</h1>
      <p>Rulebook version: {overview.event.rulesVersion} · Current stage: {overview.event.status}</p>

      <h2>Stage 1: Material Auction</h2>
      <ul>
        <li>Starting tokens: {s.stage1StartingTokens}</li>
        <li>Minimum raise: {s.minimumRaiseStandard} tokens ({s.minimumRaiseLowOpening} if opening bid is below {s.lowOpeningThreshold})</li>
        <li>Lot duration: {s.auctionLotDurationSeconds} seconds</li>
      </ul>

      <h2>Stage 2: Trade and Build</h2>
      <ul>
        <li>Trade limit: {s.tradeLimit} per team</li>
        <li>Bank tax: {s.normalBankTaxPercent}% normal, {s.rareBankTaxPercent}% on rare materials</li>
        <li>Inspections: {s.inspectionsEnabled ? `enabled (${s.inspectionCost} tokens, ${s.inspectionLimitPerTeam} per team)` : "disabled"}</li>
        <li>Leftover material scoring: {s.leftoverScoringEnabled ? `enabled (${s.leftoverUnitsPerPoint} units = 1 point)` : "disabled"}</li>
      </ul>

      <h2>Stage 3: City Auction</h2>
      <ul>
        <li>City wallet: {s.cityWalletTokens} tokens</li>
        <li>Minimum raise: {s.cityMinimumRaise} tokens</li>
        <li>Auction duration: {s.cityAuctionDurationSeconds} seconds</li>
        <li>Scout reports: {s.scoutReportsEnabled ? `enabled (${s.scoutReportCost} tokens, max ${s.scoutReportLimit} per team)` : "disabled"}</li>
        <li>Scoring mode: {s.advancedCityScoringEnabled ? "advanced (preferred building types only)" : "standard"}</li>
      </ul>

      <h2>Tiebreakers</h2>
      <ol>
        <li>Most buildings constructed</li>
        <li>Most valuable single building</li>
        <li>Most unspent tokens (city wallet + leftover)</li>
      </ol>
    </main>
  );
}
