"use client";

import { use, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";

const STAGE_LABELS: Record<string, string> = {
  setup: "Setup",
  lobby: "Lobby",
  stage_1: "Stage 1",
  stage_2: "Stage 2",
  stage_3: "Stage 3",
  scoring: "Scoring",
  completed: "Completed",
};

// Section 7.1 "Rules" — same wooden-frame + rules/heading.png banner as
// the legacy rules page, but every number is read live from this event's
// own event_settings row instead of the legacy's hard-coded static text
// (Section 3 gap assessment).
export default function RulesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      fetchJson<any>(`/api/events/${eventId}/overview`)
        .then(setOverview)
        .catch((err) => setLoadError(err instanceof FetchJsonError ? err.message : "Couldn't load the rules. Retrying…"));
    }
  }, [eventId, status]);

  if (loadError && !overview) return <PageFrame><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  const s = overview.settings;

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <div className="text-center mb-6 w-full max-w-sm">
        <img src="/assets/images/rules/heading.png" alt="Rules" className="w-full h-auto object-contain" />
      </div>

      <div className="w-full max-w-3xl p-4 md:p-6 overflow-y-auto text-yellow-100 text-sm md:text-base leading-relaxed bg-[#3b2a1a]/70 rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <p className="text-yellow-300">
            Rulebook version: {overview.event.rulesVersion} · Current stage:{" "}
            <strong>{STAGE_LABELS[overview.event.status] ?? overview.event.status}</strong>
          </p>
          {overview.isStaff && (
            <a
              href={`/events/${eventId}/moderator/setup#rules-settings`}
              className="px-3 py-1.5 rounded text-sm bg-[#463d36] text-[#F1EBB5] hover:bg-[#62574e] shadow whitespace-nowrap"
            >
              Edit these rules
            </a>
          )}
        </div>

        {s.customRulesNote && (
          <div className="mb-4 p-3 bg-yellow-900/40 border border-yellow-700 rounded whitespace-pre-wrap">{s.customRulesNote}</div>
        )}

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
