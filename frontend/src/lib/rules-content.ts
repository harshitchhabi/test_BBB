// Shared between rules/page.tsx (renders it) and moderator/setup/page.tsx
// (edits it) so the two can never drift on what "the default text" means
// for a stage that hasn't been custom-edited yet.
export const RULES_CONTENT_STAGES = ["stage1", "stage2", "stage3", "tiebreakers"] as const;
export type RulesContentStage = (typeof RULES_CONTENT_STAGES)[number];
export const RULES_STAGE_LABELS: Record<RulesContentStage, string> = {
  stage1: "Stage 1: Material Auction",
  stage2: "Stage 2: Trade and Build",
  stage3: "Stage 3: City Auction",
  tiebreakers: "Tiebreakers",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defaultRulesForStage(stage: RulesContentStage, s: any): string[] {
  switch (stage) {
    case "stage1":
      return [
        `Starting tokens: ${s.stage1StartingTokens}`,
        `Minimum raise: ${s.minimumRaiseStandard} tokens (${s.minimumRaiseLowOpening} if opening bid is below ${s.lowOpeningThreshold})`,
        `Lot duration: ${s.auctionLotDurationSeconds} seconds`,
      ];
    case "stage2":
      return [
        `Trade limit: ${s.tradeLimit} per team`,
        `Bank tax: ${s.normalBankTaxPercent}% normal, ${s.rareBankTaxPercent}% on rare materials`,
        `Inspections: ${s.inspectionsEnabled ? `enabled (${s.inspectionCost} tokens, ${s.inspectionLimitPerTeam} per team)` : "disabled"}`,
        `Leftover material scoring: ${s.leftoverScoringEnabled ? `enabled (${s.leftoverUnitsPerPoint} units = 1 point)` : "disabled"}`,
      ];
    case "stage3":
      return [
        `City wallet: ${s.cityWalletTokens} tokens`,
        `Minimum raise: ${s.cityMinimumRaise} tokens`,
        `Auction duration: ${s.cityAuctionDurationSeconds} seconds`,
        `Scout reports: ${s.scoutReportsEnabled ? `enabled (${s.scoutReportCost} tokens, max ${s.scoutReportLimit} per team)` : "disabled"}`,
        `Scoring mode: ${s.advancedCityScoringEnabled ? "advanced (preferred building types only)" : "standard"}`,
      ];
    case "tiebreakers":
      return ["Most buildings constructed", "Most valuable single building", "Most unspent tokens (city wallet + leftover)"];
  }
}

export function parseRulesContent(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
