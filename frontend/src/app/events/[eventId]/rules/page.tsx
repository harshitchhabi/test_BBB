"use client";

import { use, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";

// Section 7.1 "Rules" — same wooden-frame + rules/heading.png banner as
// the legacy rules page, but every number is read live from this event's
// own event_settings row instead of the legacy's hard-coded static text
// (Section 3 gap assessment).
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

  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  const s = overview.settings;

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <div className="text-center mb-6 w-full max-w-sm">
        <img src="/assets/images/rules/heading.png" alt="Rules" className="w-full h-auto object-contain" />
      </div>

      <div className="w-full max-w-3xl p-4 md:p-6 overflow-y-auto text-yellow-100 text-sm md:text-base leading-relaxed bg-[#3b2a1a]/70 rounded-lg">
        <p className="mb-4 text-yellow-300">
          Rulebook version: {overview.event.rulesVersion} · Current stage: <strong>{overview.event.status}</strong>
        </p>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Stage 1: Material Auction</h2>
        <ul className="list-disc list-inside mb-4">
          <li>Starting tokens: {s.stage1StartingTokens}</li>
          <li>Minimum raise: {s.minimumRaiseStandard} tokens ({s.minimumRaiseLowOpening} if opening bid is below {s.lowOpeningThreshold})</li>
          <li>Lot duration: {s.auctionLotDurationSeconds} seconds</li>
        </ul>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Stage 2: Trade and Build</h2>
        <ul className="list-disc list-inside mb-4">
          <li>Trade limit: {s.tradeLimit} per team</li>
          <li>Bank tax: {s.normalBankTaxPercent}% normal, {s.rareBankTaxPercent}% on rare materials</li>
          <li>Inspections: {s.inspectionsEnabled ? `enabled (${s.inspectionCost} tokens, ${s.inspectionLimitPerTeam} per team)` : "disabled"}</li>
          <li>Leftover material scoring: {s.leftoverScoringEnabled ? `enabled (${s.leftoverUnitsPerPoint} units = 1 point)` : "disabled"}</li>
        </ul>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Stage 3: City Auction</h2>
        <ul className="list-disc list-inside mb-4">
          <li>City wallet: {s.cityWalletTokens} tokens</li>
          <li>Minimum raise: {s.cityMinimumRaise} tokens</li>
          <li>Auction duration: {s.cityAuctionDurationSeconds} seconds</li>
          <li>Scout reports: {s.scoutReportsEnabled ? `enabled (${s.scoutReportCost} tokens, max ${s.scoutReportLimit} per team)` : "disabled"}</li>
          <li>Scoring mode: {s.advancedCityScoringEnabled ? "advanced (preferred building types only)" : "standard"}</li>
        </ul>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Tiebreakers</h2>
        <ol className="list-decimal list-inside">
          <li>Most buildings constructed</li>
          <li>Most valuable single building</li>
          <li>Most unspent tokens (city wallet + leftover)</li>
        </ol>
      </div>
    </PageFrame>
  );
}
