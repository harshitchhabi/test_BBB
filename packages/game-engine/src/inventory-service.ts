import { db, eq, and, sql } from "db";
import { teamInventoryTransactions, materialTypes } from "db/schema";
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
