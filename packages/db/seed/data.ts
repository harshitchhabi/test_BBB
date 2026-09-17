// Rulebook-derived seed content (bbb.1.docx). Every number here is
// transcribed directly from the rulebook, not invented — see the citations
// in each comment. This is the Phase 0 deliverable: "convert the paper
// rules into a verified event configuration" that a moderator reviews
// before anything is wired into game logic.

// ---------------------------------------------------------------------
// Materials — rulebook "Lot (material) / How many units / Bidding starts
// at" table (Stage 1). One lot of this shape is added per team per
// material when a round starts (Phase 1 concern; the quantities/opening
// bids below are the per-team template).
//
// isRare drives the Stage 2 bank tax split: rulebook Stage 2 — "a 10% tax,
// rising to 20% on the three rare materials (Steel, Glass, Medical)."
// isBonusOnly = true for materials that are never a recipe ingredient:
// Blueprint ("not a building material and is never part of a recipe") and
// Solar (never appears in any Appendix A recipe; it only ever grants the
// +10/+15 Eco bonus).
// ---------------------------------------------------------------------
// Revision 2 ("balance-audited edition"): Bricks, Cement, Steel, Wood,
// and Glass used to be seeded as one big lot per team (e.g. Bricks: 600
// units opening at 600). The audited revision splits each of these five
// into round(activeTeamCount * 2.5) smaller lots per round instead (for
// an 8-team baseline: 20 lots), each of the PER-LOT size/opening-bid
// below — total supply and the per-unit sticker price are unchanged,
// only the granularity is. splitLots marks these five for that
// per-round lot-count formula (see auction-service.ts's startRound);
// every other material stays exactly one lot per team as before.
// reservedKitEligible marks Bricks/Cement/Steel only, per the new
// Reserved Kit rule (claim one lot at printed opening price, no
// bidding, before open bidding starts on that material).
export const MATERIAL_SEED = [
  { key: "bricks", name: "Bricks", unitLabel: "units", lotQuantity: 240, openingBid: 240, isRare: false, isBonusOnly: false, sortOrder: 1, splitLots: true, reservedKitEligible: true },
  { key: "cement", name: "Cement", unitLabel: "units", lotQuantity: 120, openingBid: 360, isRare: false, isBonusOnly: false, sortOrder: 2, splitLots: true, reservedKitEligible: true },
  { key: "steel", name: "Steel", unitLabel: "units", lotQuantity: 40, openingBid: 320, isRare: true, isBonusOnly: false, sortOrder: 3, splitLots: true, reservedKitEligible: true },
  { key: "wood", name: "Wood", unitLabel: "units", lotQuantity: 48, openingBid: 96, isRare: false, isBonusOnly: false, sortOrder: 4, splitLots: true, reservedKitEligible: false },
  { key: "glass", name: "Glass", unitLabel: "units", lotQuantity: 32, openingBid: 192, isRare: true, isBonusOnly: false, sortOrder: 5, splitLots: true, reservedKitEligible: false },
  { key: "pipes", name: "Pipes", unitLabel: "units", lotQuantity: 20, openingBid: 75, isRare: false, isBonusOnly: false, sortOrder: 6, splitLots: false, reservedKitEligible: false },
  { key: "wires", name: "Wires", unitLabel: "units", lotQuantity: 20, openingBid: 75, isRare: false, isBonusOnly: false, sortOrder: 7, splitLots: false, reservedKitEligible: false },
  { key: "medical", name: "Medical", unitLabel: "units", lotQuantity: 8, openingBid: 125, isRare: true, isBonusOnly: false, sortOrder: 8, splitLots: false, reservedKitEligible: false },
  { key: "furniture", name: "Furniture", unitLabel: "units", lotQuantity: 8, openingBid: 50, isRare: false, isBonusOnly: false, sortOrder: 9, splitLots: false, reservedKitEligible: false },
  { key: "marble", name: "Marble", unitLabel: "units", lotQuantity: 4, openingBid: 50, isRare: false, isBonusOnly: false, sortOrder: 10, splitLots: false, reservedKitEligible: false },
  { key: "tiles", name: "Tiles", unitLabel: "units", lotQuantity: 4, openingBid: 25, isRare: false, isBonusOnly: false, sortOrder: 11, splitLots: false, reservedKitEligible: false },
  { key: "solar", name: "Solar", unitLabel: "panels", lotQuantity: 4, openingBid: 50, isRare: false, isBonusOnly: true, sortOrder: 12, splitLots: false, reservedKitEligible: false },
  { key: "blueprint", name: "Blueprint", unitLabel: "blueprint", lotQuantity: 1, openingBid: 40, isRare: false, isBonusOnly: true, sortOrder: 13, splitLots: false, reservedKitEligible: false },
] as const;

// stickerPrice = openingBid / lotQuantity, rounded up per rulebook ("A
// lot's opening bid is its units x sticker price, rounded up to the chip
// grid"). Computed here rather than duplicated by hand so it can never
// drift from the lot numbers above.
export function stickerPriceFor(material: (typeof MATERIAL_SEED)[number]) {
  return Math.ceil(material.openingBid / material.lotQuantity);
}

// ---------------------------------------------------------------------
// Market Shock cards — rulebook Stage 1 "Market Shock cards" table.
// effect is a machine-readable description for the Phase 2 auction engine;
// see the comment on marketShockCards.effectJson in
// packages/db/schema/materials.ts for the shape.
// ---------------------------------------------------------------------
export const MARKET_SHOCK_SEED = [
  {
    key: "steel_embargo",
    title: "Steel Embargo",
    description: "Steel's opening bids double for this round.",
    effect: { type: "opening_bid_multiplier", materialKey: "steel", multiplier: 2 },
  },
  {
    key: "construction_boom",
    title: "Construction Boom",
    description: "Hospitals and Industry are worth +15 points for the rest of the game.",
    effect: { type: "flat_bonus_points", recipeKeys: ["hospital", "industry"], points: 15 },
  },
  {
    key: "glass_surplus",
    title: "Glass Surplus",
    description: "The next Glass lot sold this round opens at half its normal price.",
    effect: { type: "next_lot_price_multiplier", materialKey: "glass", multiplier: 0.5 },
  },
  {
    key: "supply_crunch",
    title: "Supply Crunch",
    description:
      "The unsold material with the smallest lot size opens 50% higher (Medical first, then Marble/Tiles/Solar/Blueprint).",
    effect: {
      type: "smallest_unsold_lot_price_increase",
      percent: 50,
      priorityMaterialKeys: ["medical", "marble", "tiles", "solar", "blueprint"],
    },
  },
  {
    key: "investor_grant",
    title: "Investor Grant",
    description: "Every team immediately receives an extra 200 tokens.",
    effect: { type: "grant_tokens_all_teams", amount: 200 },
  },
  {
    key: "eco_incentive",
    title: "Eco Incentive",
    description: "Solar lots are free this round; Solar attached this round gives +15 Eco instead of +10.",
    effect: { type: "material_free_this_round", materialKey: "solar", ecoBonusOverride: 15 },
  },
] as const;

// ---------------------------------------------------------------------
// Building recipes — rulebook Appendix A "Building Recipe Cards" (the
// canonical, cleanly formatted source — preferred over the earlier
// abbreviated "at a glance" table in the main body, which the same
// document immediately supersedes with "full table in Stage 2").
// ---------------------------------------------------------------------
export const RECIPE_SEED = [
  {
    key: "park",
    name: "Park",
    basePoints: 13,
    sortOrder: 1,
    requirements: { bricks: 50, cement: 20, wood: 40, furniture: 1 },
  },
  {
    key: "vineyard",
    name: "Vineyard",
    basePoints: 26,
    sortOrder: 2,
    requirements: { bricks: 100, cement: 50, steel: 10, wood: 30, pipes: 1, wires: 1 },
  },
  {
    key: "home",
    name: "Home",
    basePoints: 29,
    sortOrder: 3,
    requirements: { bricks: 100, cement: 50, steel: 10, wood: 20, glass: 10, pipes: 1, wires: 1, furniture: 1 },
  },
  {
    key: "office",
    name: "Office",
    basePoints: 83,
    sortOrder: 4,
    requirements: { bricks: 150, cement: 100, steel: 50, wood: 40, glass: 50, furniture: 1, tiles: 1 },
  },
  {
    key: "mall",
    name: "Mall",
    basePoints: 88,
    sortOrder: 5,
    requirements: { bricks: 200, cement: 150, steel: 30, wood: 60, glass: 50, tiles: 1, marble: 1 },
  },
  {
    key: "apartment",
    name: "Apartment",
    basePoints: 90,
    sortOrder: 6,
    requirements: { bricks: 300, cement: 150, steel: 30, wood: 50, glass: 40, pipes: 3, wires: 3, furniture: 1 },
  },
  {
    key: "university",
    name: "University",
    // Rulebook v2 balance-audit correction: 130 implied a per-point cost
    // ~18% below every other building (this recipe costs 1,648.75 tokens
    // at these materials' sticker prices, i.e. ~110 points at the same
    // rate every other building follows, not 130). Corrected to 110 so
    // no building is a hidden bargain.
    basePoints: 110,
    sortOrder: 7,
    requirements: { bricks: 350, cement: 200, steel: 70, wood: 60, furniture: 1, marble: 1 },
  },
  {
    key: "hospital",
    name: "Hospital",
    basePoints: 147,
    sortOrder: 8,
    requirements: { bricks: 300, cement: 200, steel: 50, wood: 40, glass: 50, medical: 30, pipes: 3, wires: 3 },
  },
  {
    key: "industry",
    name: "Industry",
    basePoints: 143,
    sortOrder: 9,
    requirements: { bricks: 400, cement: 250, steel: 100, wood: 30, glass: 20, pipes: 3, wires: 3 },
  },
] as const;

// ---------------------------------------------------------------------
// Cities — rulebook Appendix B ("The 50-City Bank") for tier / opening bid
// / preferred buildings, cross-referenced with Appendix C ("Secret
// Multiplier Key") for the hidden multiplier, isTrap, isSleeper flags.
//
// IMPORTANT GAP IN THE SOURCE RULEBOOK, not an extraction error: Appendix B
// only prints the tier/opening-bid/preferred-buildings table for Blocks
// 1-4. Appendix C's multiplier key does list Block 5 (Nagpur, Indore,
// Coimbatore, Udaipur, Madurai, Vijayawada, Kochi, Tirupati, Mahabaleshwar,
// Pondicherry, with multipliers and trap/sleeper callouts), but nowhere in
// the document is Block 5's tier or preferred-buildings table printed. We
// deliberately do NOT invent tiers/preferences for Block 5 — seed only
// Blocks 1-4 (40 cities) here, which is already comfortably more than the
// "one block per 8-10 teams" guidance covers for any realistically sized
// event, and flag Block 5 for the moderator to supply before it's needed.
// ---------------------------------------------------------------------
const CITY_TIER_OPENING_BID = { metro: 400, city: 250, town: 100 } as const;

export const CITY_BLOCK_SEED = [
  {
    block: 1,
    cities: [
      { name: "Bangalore", tier: "metro", multiplier: "3.5", preferred: ["hospital", "mall", "apartment"] },
      { name: "Mumbai", tier: "metro", multiplier: "3.0", preferred: ["office", "vineyard", "university"] },
      { name: "Delhi", tier: "metro", multiplier: "2.5", preferred: ["park", "office", "industry"], isTrap: true },
      { name: "Bhopal", tier: "city", multiplier: "3.0", preferred: ["vineyard", "mall", "industry"] },
      { name: "Visakhapatnam", tier: "city", multiplier: "2.5", preferred: ["hospital", "home", "mall"] },
      { name: "Patna", tier: "city", multiplier: "2.0", preferred: ["home", "park", "vineyard"] },
      { name: "Vadodara", tier: "city", multiplier: "3.5", preferred: ["university", "hospital", "apartment"] },
      { name: "Coorg", tier: "town", multiplier: "2.0", preferred: ["office", "park"] },
      { name: "Leh", tier: "town", multiplier: "1.5", preferred: ["home", "industry"] },
      { name: "Rishikesh", tier: "town", multiplier: "4.0", preferred: ["university", "apartment"], isSleeper: true },
    ],
  },
  {
    block: 2,
    cities: [
      { name: "Chennai", tier: "metro", multiplier: "4.0", preferred: ["home", "industry", "mall"] },
      { name: "Hyderabad", tier: "metro", multiplier: "3.0", preferred: ["vineyard", "industry", "hospital"] },
      { name: "Kolkata", tier: "metro", multiplier: "2.5", preferred: ["mall", "home", "park"], isTrap: true },
      { name: "Ludhiana", tier: "city", multiplier: "2.5", preferred: ["hospital", "apartment", "university"] },
      { name: "Agra", tier: "city", multiplier: "3.0", preferred: ["park", "apartment", "home"] },
      { name: "Nashik", tier: "city", multiplier: "2.0", preferred: ["vineyard", "park", "industry"] },
      { name: "Rajkot", tier: "city", multiplier: "3.5", preferred: ["office", "vineyard", "mall"] },
      { name: "Jaisalmer", tier: "town", multiplier: "1.5", preferred: ["apartment", "university"] },
      { name: "Shimla", tier: "town", multiplier: "2.0", preferred: ["office", "hospital"] },
      { name: "Manali", tier: "town", multiplier: "3.5", preferred: ["university", "office"], isSleeper: true },
    ],
  },
  {
    block: 3,
    cities: [
      { name: "Pune", tier: "metro", multiplier: "3.5", preferred: ["office", "hospital", "mall"] },
      { name: "Ahmedabad", tier: "metro", multiplier: "2.5", preferred: ["industry", "hospital", "vineyard"], isTrap: true },
      { name: "Surat", tier: "metro", multiplier: "3.0", preferred: ["apartment", "home", "industry"] },
      { name: "Varanasi", tier: "city", multiplier: "3.5", preferred: ["home", "office", "park"] },
      { name: "Amritsar", tier: "city", multiplier: "2.0", preferred: ["mall", "park", "university"] },
      { name: "Ranchi", tier: "city", multiplier: "3.0", preferred: ["park", "university", "apartment"] },
      { name: "Jodhpur", tier: "city", multiplier: "2.5", preferred: ["university", "hospital", "mall"] },
      { name: "Darjeeling", tier: "town", multiplier: "4.0", preferred: ["vineyard", "office"], isSleeper: true },
      { name: "Ooty", tier: "town", multiplier: "1.5", preferred: ["home", "vineyard"] },
      { name: "Munnar", tier: "town", multiplier: "2.0", preferred: ["industry", "apartment"] },
    ],
  },
  {
    block: 4,
    cities: [
      { name: "Jaipur", tier: "metro", multiplier: "3.0", preferred: ["university", "mall", "park"] },
      { name: "Lucknow", tier: "metro", multiplier: "2.5", preferred: ["apartment", "university", "industry"], isTrap: true },
      { name: "Kanpur", tier: "metro", multiplier: "3.5", preferred: ["park", "home", "apartment"] },
      { name: "Kota", tier: "city", multiplier: "2.0", preferred: ["office", "mall", "home"] },
      { name: "Guwahati", tier: "city", multiplier: "3.5", preferred: ["industry", "university", "office"] },
      { name: "Chandigarh", tier: "city", multiplier: "2.5", preferred: ["apartment", "vineyard", "hospital"] },
      { name: "Mysore", tier: "city", multiplier: "3.0", preferred: ["hospital", "home", "park"] },
      { name: "Gangtok", tier: "town", multiplier: "2.0", preferred: ["hospital", "vineyard"] },
      { name: "Panaji", tier: "town", multiplier: "4.0", preferred: ["office", "industry"], isSleeper: true },
      { name: "Mangalore", tier: "town", multiplier: "1.5", preferred: ["mall", "vineyard"] },
    ],
  },
] as const satisfies ReadonlyArray<{
  block: number;
  cities: ReadonlyArray<{
    name: string;
    tier: keyof typeof CITY_TIER_OPENING_BID;
    multiplier: string;
    preferred: readonly string[];
    isTrap?: boolean;
    isSleeper?: boolean;
  }>;
}>;

export function openingBidForTier(tier: keyof typeof CITY_TIER_OPENING_BID) {
  return CITY_TIER_OPENING_BID[tier];
}

// Block 5 multipliers ARE in Appendix C (for when the moderator supplies
// the missing tier/preferred-building data and wants to add it):
// Nagpur 3.5x, Indore 3x, Coimbatore 2.5x (TRAP), Udaipur 3x, Madurai 2.5x,
// Vijayawada 3.5x, Kochi 2x, Tirupati 1.5x, Mahabaleshwar 3.5x (SLEEPER),
// Pondicherry 2x.
export const BLOCK_5_MULTIPLIERS_ONLY_NO_TIER_DATA = {
  nagpur: "3.5",
  indore: "3.0",
  coimbatore: "2.5",
  udaipur: "3.0",
  madurai: "2.5",
  vijayawada: "3.5",
  kochi: "2.0",
  tirupati: "1.5",
  mahabaleshwar: "3.5",
  pondicherry: "2.0",
} as const;
