// Full event-scoped schema per EVENT_PORTAL_IMPLEMENTATION_PLAN.md Section
// 5. Split by domain instead of one flat file (the legacy
// packages/db/schema.ts) because this is ~25 tables across 7 concerns —
// identity/event setup, materials, Stage 1 auction, Stage 2 inventory &
// trading, buildings, Stage 3 cities, and scoring/audit.
export * from "./enums";
export * from "./identity";
export * from "./materials";
export * from "./auction";
export * from "./inventory";
export * from "./buildings";
export * from "./cities";
export * from "./scoring";

import * as enums from "./enums";
import * as identity from "./identity";
import * as materials from "./materials";
import * as auction from "./auction";
import * as inventory from "./inventory";
import * as buildings from "./buildings";
import * as cities from "./cities";
import * as scoring from "./scoring";

export const schema = {
  ...enums,
  ...identity,
  ...materials,
  ...auction,
  ...inventory,
  ...buildings,
  ...cities,
  ...scoring,
};
