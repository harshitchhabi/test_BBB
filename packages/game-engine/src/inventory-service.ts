import { db, eq, and, sql } from "db";
import { teamInventoryTransactions, materialTypes, teams } from "db/schema";
import type { Tx } from "./tx";

// Section 5.4: "The current stock becomes a queryable view: current
// quantity for team and material = SUM(quantity_delta)." There is
// deliberately no mutable stock column anywhere for a client to spoof or
// for two writers to race on — every credit/debit is its own ledger row,
// and "how much does this team have" is always this sum, computed fresh.

export interface InventoryLine {
  materialTypeId: string;
  materialKey: string;
  materialName: string;
  quantity: number;
}

async function currentInventory(executor: Tx | typeof db, eventId: string, teamId: string): Promise<InventoryLine[]> {
  const rows = await executor
    .select({
      materialTypeId: materialTypes.id,
      materialKey: materialTypes.key,
      materialName: materialTypes.name,
      quantity: sql<number>`coalesce(sum(${teamInventoryTransactions.quantityDelta}), 0)`,
    })
    .from(materialTypes)
    .leftJoin(
      teamInventoryTransactions,
      and(eq(teamInventoryTransactions.materialTypeId, materialTypes.id), eq(teamInventoryTransactions.teamId, teamId)),
    )
    .where(eq(materialTypes.eventId, eventId))
    .groupBy(materialTypes.id, materialTypes.key, materialTypes.name);

  return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
}

// Outside a transaction — for read-model API routes (the Inventory screen,
// Section 7.4).
export async function getTeamInventory(eventId: string, teamId: string): Promise<InventoryLine[]> {
  return currentInventory(db, eventId, teamId);
}

// Inside a transaction — for services (trade, bank purchase, construction)
// that need to check a team's current stock before committing to consume
// it, using the same row set their own writes will land in.
export async function getTeamInventoryTx(tx: Tx, eventId: string, teamId: string): Promise<InventoryLine[]> {
  return currentInventory(tx, eventId, teamId);
}

export async function getQuantityForMaterial(
  tx: Tx,
  eventId: string,
  teamId: string,
  materialTypeId: string,
): Promise<number> {
  const [row] = await tx
    .select({ quantity: sql<number>`coalesce(sum(${teamInventoryTransactions.quantityDelta}), 0)` })
    .from(teamInventoryTransactions)
    .where(
      and(
        eq(teamInventoryTransactions.eventId, eventId),
        eq(teamInventoryTransactions.teamId, teamId),
        eq(teamInventoryTransactions.materialTypeId, materialTypeId),
      ),
    );
  return Number(row?.quantity ?? 0);
}

// Full source history for one team/material — Section 7.4 "Material
// source history: won, traded, bought from bank, consumed" and the
// print-friendly inventory statement.
export async function getInventoryLedger(eventId: string, teamId: string) {
  return db
    .select()
    .from(teamInventoryTransactions)
    .where(and(eq(teamInventoryTransactions.eventId, eventId), eq(teamInventoryTransactions.teamId, teamId)))
    .orderBy(teamInventoryTransactions.createdAt);
}

export interface TeamInventorySummary {
  teamId: string;
  teamName: string;
  status: string;
  materials: InventoryLine[];
}

// Deliberately different visibility from getTeamInventory: a team's
// MATERIAL holdings (not its token balance, not its score) are exposed
// to every other team in the event, not just staff and the team itself.
// Added because there was no way for a team to know what anyone else
// actually had to offer before proposing a trade — the Trade desk made
// them guess a counterparty's materials blind. Tokens/scores stay
// private (Section 8.3); only material counts, which a real trade
// negotiation genuinely needs, are shared here.
export async function getAllTeamsInventory(eventId: string): Promise<TeamInventorySummary[]> {
  const teamRows = await db
    .select({ id: teams.id, name: teams.name, status: teams.status })
    .from(teams)
    .where(eq(teams.eventId, eventId));

  const rows = await db
    .select({
      teamId: teamInventoryTransactions.teamId,
      materialTypeId: materialTypes.id,
      materialKey: materialTypes.key,
      materialName: materialTypes.name,
      quantity: sql<number>`coalesce(sum(${teamInventoryTransactions.quantityDelta}), 0)`,
    })
    .from(materialTypes)
    .leftJoin(teamInventoryTransactions, eq(teamInventoryTransactions.materialTypeId, materialTypes.id))
    .where(eq(materialTypes.eventId, eventId))
    .groupBy(teamInventoryTransactions.teamId, materialTypes.id, materialTypes.key, materialTypes.name);

  const materialsByTeam = new Map<string, InventoryLine[]>();
  for (const r of rows) {
    if (!r.teamId) continue; // no transactions at all for this material yet, for any team
    const list = materialsByTeam.get(r.teamId) ?? [];
    const quantity = Number(r.quantity);
    if (quantity !== 0) list.push({ materialTypeId: r.materialTypeId, materialKey: r.materialKey, materialName: r.materialName, quantity });
    materialsByTeam.set(r.teamId, list);
  }

  return teamRows.map((t) => ({ teamId: t.id, teamName: t.name, status: t.status, materials: materialsByTeam.get(t.id) ?? [] }));
}
