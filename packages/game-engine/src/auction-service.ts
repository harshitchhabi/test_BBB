import { db, eq, and, sql, inArray } from "db";
import {
  events,
  eventSettings,
  teams,
  materialTypes,
  materialLots,
  auctionRounds,
  auctionLots,
  bids,
  teamInventoryTransactions,
} from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { drawShockCard, applyMaterialEffect, applyGlobalEffect, type ShockEffect } from "./market-shock-service";
import { assertTeamLeaderTx, assertStaffTx } from "./team-service";

// Section 6.2/6.3 workflows, Section 3.1 issues #1-4, made concrete:
//   - one service, no in-memory session state (contrast with the legacy
//     backend/lib/bidding-manager.ts + backend/websocket-server.ts, which
//     duplicated this logic in memory in two places and lost it on
//     restart);
//   - every mutation happens inside runInTransaction, which takes out
//     row locks (`.for("update")`) on the team and the lot before
//     validating anything, so two concurrent bids on the same lot (or two
//     bids draining the same team's balance at once) serialize instead of
//     racing;
//   - a bid that fails a rule is still persisted as a rejected row
//     (Section 3.1 #5 / Section 5.3 "never silently discard a rejected
//     bid") rather than just bouncing an error back to the client.

// Rulebook v2: the five "split" materials (Bricks/Cement/Steel/Wood/
// Glass) raise by 50; every other material raises by 25 — a flat rule
// keyed off the material itself, not the opening-bid-tier formula
// event_settings.minimumRaise{Standard,LowOpening}/lowOpeningThreshold
// still drives for the city auction. That generic tier formula would
// actually give the WRONG number here for at least two materials (Wood
// opens at 96, Medical at 125 — both would land on the wrong side of a
// generic threshold).
function minimumRaiseFor(material: { splitLots: boolean }): number {
  return material.splitLots ? 50 : 25;
}

// Rulebook v2 Lot Cap: a hard, unconditional ceiling — no team may ever
// hold more than this many lots of the same material, counting both
// auction wins and a claimed Reserved Kit lot together.
const LOT_CAP_PER_TEAM_PER_MATERIAL = 2;

async function countTeamLotsOfMaterial(tx: Tx, eventId: string, teamId: string, materialTypeId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(materialLots)
    .where(
      and(
        eq(materialLots.eventId, eventId),
        eq(materialLots.materialTypeId, materialTypeId),
        eq(materialLots.ownerTeamId, teamId),
        eq(materialLots.status, "sold"),
      ),
    );
  return Number(row?.count ?? 0);
}

async function assertStage1(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_1") {
    throw new GameError("invalid_event_stage", "The material auction is only open during Stage 1.");
  }
  return event;
}

// Once every lot in a round has left "pending"/"live" (closed, unsold, or
// voided), the round itself is done — nothing in Section 5.3 ever flips
// auction_rounds.status away from "active" on its own, so without this a
// round would stay "active" forever and startRound's "only one active
// round at a time" guard would permanently block the next material.
async function completeRoundIfFinished(tx: Tx, eventId: string, roundId: string) {
  const [stillOpen] = await tx
    .select({ id: auctionLots.id })
    .from(auctionLots)
    .where(and(eq(auctionLots.roundId, roundId), sql`${auctionLots.status} in ('pending', 'live')`));
  if (stillOpen) return;

  await tx
    .update(auctionRounds)
    .set({ status: "completed", closedAt: new Date() })
    .where(eq(auctionRounds.id, roundId));
  await tx
    .update(events)
    .set({ activeRoundId: null })
    .where(and(eq(events.id, eventId), eq(events.activeRoundId, roundId)));
}

// Instantiates one auction lot per active team for a material round —
// rulebook: "For each team in the room, the moderator adds one of each lot
// below." Each lot gets its own material_lot (the finite, real unit being
// sold) plus an auction_lot (the live-sale record), sequenced by team
// join order. Market-shock price adjustment is applied by the caller
// (Phase 2 concern) before this runs, by passing an already-adjusted
// openingBid.
export async function startRound(params: {
  eventId: string;
  materialTypeId: string;
  actorParticipantId: string;
  openingBidOverride?: number;
  // Lets the moderator set how much material each lot in this round
  // contains, instead of it always being the value the material was
  // seeded with (material.defaultLotQuantity) — same override pattern as
  // openingBidOverride above. Every lot this round creates (one per
  // active team) gets this same quantity; the winner of a lot is
  // credited exactly this many units in closeLot.
  lotQuantityOverride?: number;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    const event = await assertStage1(tx, params.eventId);
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    if (params.lotQuantityOverride !== undefined && (!Number.isInteger(params.lotQuantityOverride) || params.lotQuantityOverride <= 0)) {
      throw new GameError("invalid_input", "Lot quantity must be a positive whole number.");
    }

    const [material] = await tx.select().from(materialTypes).where(eq(materialTypes.id, params.materialTypeId));
    if (!material) throw new GameError("not_found", "Material type not found.");

    // A moderator can now have several materials' rounds "active" at
    // once — pausing one (its remaining lots stay pending) to run
    // another, then resuming the first later via openNextLot — rather
    // than being forced to fully exhaust one material before starting
    // the next. What's still not allowed is two rounds for the SAME
    // material at once, and (enforced separately in openNextLot) two
    // LIVE lots at once anywhere in the event — there's only one live
    // auction actually happening in the room at a time.
    const [existingRoundForMaterial] = await tx
      .select()
      .from(auctionRounds)
      .where(and(eq(auctionRounds.eventId, params.eventId), eq(auctionRounds.materialTypeId, params.materialTypeId), eq(auctionRounds.status, "active")));
    if (existingRoundForMaterial) {
      throw new GameError("conflict", "A round for this material is already active — resume it instead of starting another.");
    }

    const activeTeams = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, params.eventId), eq(teams.status, "active")));
    if (activeTeams.length === 0) {
      throw new GameError("conflict", "No active teams to auction to.");
    }

    const [nextSequence] = await tx
      .select({ maxSequence: sql<number>`coalesce(max(${auctionRounds.sequence}), 0)` })
      .from(auctionRounds)
      .where(eq(auctionRounds.eventId, params.eventId));

    const sequence = (nextSequence?.maxSequence ?? 0) + 1;

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    // Rulebook v2: Bricks/Cement/Steel/Wood/Glass sell as
    // round(activeTeamCount * 2.5) lots per round; every other material
    // stays one lot per team, same as before the split.
    const lotCount = material.splitLots ? Math.round(activeTeams.length * 2.5) : activeTeams.length;

    let openingBid = params.openingBidOverride ?? material.defaultOpeningBid;
    let perLotOpeningBidOverrides = new Map<number, number>();
    let ecoBonusOverride: number | null = null;
    const shockNotes: string[] = [];

    // Automated Supply Crunch follow-through: a PREVIOUS round's Supply
    // Crunch shock may have flagged this exact material for an
    // opening-bid increase the next time it comes up for auction (see
    // market-shock-service.ts's applyGlobalEffect) — applied and cleared
    // here instead of left as a note for the moderator to apply by hand.
    // A manual openingBidOverride still takes full precedence over this,
    // same as it always has over any drawn shock's effect below.
    if (!params.openingBidOverride && material.pendingOpeningBidIncreasePercent) {
      const pendingPercent = material.pendingOpeningBidIncreasePercent;
      openingBid = Math.ceil(openingBid * (1 + pendingPercent / 100));
      await tx.update(materialTypes).set({ pendingOpeningBidIncreasePercent: null }).where(eq(materialTypes.id, material.id));
      shockNotes.push(`${material.key} opens ${pendingPercent}% higher this round (automatic Supply Crunch follow-through).`);
    }

    // Rulebook: "At the start of every round after the first, flip one
    // Market Shock card." A card whose effect doesn't concern this round's
    // material still gets revealed (moderator sees it, teams see it) —
    // see market-shock-service.ts's applyMaterialEffect comment for why
    // that's the intended behavior, not a bug.
    const drawnShock = sequence > 1 ? await drawShockCard(tx, params.eventId) : null;

    if (drawnShock && !params.openingBidOverride) {
      const effect: ShockEffect = JSON.parse(drawnShock.effectJson);
      // Feeds this round's already-Supply-Crunch-adjusted opening bid in
      // as the "default" a multiplier-type effect scales from, so the
      // two stack correctly instead of the drawn card's multiplier
      // silently discarding the pending increase.
      const materialResult = applyMaterialEffect(effect, { ...material, defaultOpeningBid: openingBid }, lotCount);
      openingBid = materialResult.adjustedOpeningBid;
      perLotOpeningBidOverrides = materialResult.perLotOpeningBidOverrides;
      ecoBonusOverride = materialResult.ecoBonusOverride;
      const globalNote = await applyGlobalEffect(tx, params.eventId, effect, params.actorParticipantId);
      shockNotes.push(globalNote ?? materialResult.note);
    }

    const shockNote = shockNotes.length > 0 ? shockNotes.join(" ") : null;

    const [round] = await tx
      .insert(auctionRounds)
      .values({
        eventId: params.eventId,
        materialTypeId: params.materialTypeId,
        sequence,
        status: "active",
        marketShockCardId: drawnShock?.cardId,
        startedAt: new Date(),
        ecoBonusOverride,
      })
      .returning();

    const minimumRaise = minimumRaiseFor(material);

    for (let lotNumber = 1; lotNumber <= lotCount; lotNumber++) {
      const thisLotOpeningBid = perLotOpeningBidOverrides.get(lotNumber) ?? openingBid;
      const [materialLot] = await tx
        .insert(materialLots)
        .values({
          eventId: params.eventId,
          materialTypeId: material.id,
          quantity: params.lotQuantityOverride ?? material.defaultLotQuantity,
          openingBid: thisLotOpeningBid,
          source: "auction",
          status: "auctioning",
        })
        .returning();

      await tx.insert(auctionLots).values({
        eventId: params.eventId,
        roundId: round.id,
        materialLotId: materialLot.id,
        lotNumber,
        openingBid: thisLotOpeningBid,
        minimumRaise,
        status: "pending",
      });
    }

    // Not set here on purpose: event.activeRoundId now tracks whichever
    // round currently has a LIVE lot (set by openNextLot, cleared by
    // closeLot), not "the most recently started round" — a freshly
    // started round sits paused with every lot pending until the
    // moderator actually opens its first lot, same as a round being
    // resumed after being paused mid-way.

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "auction_round.started",
      entityType: "auction_round",
      entityId: round.id,
      afterJson: { round, materialKey: material.key, lotCount, shock: drawnShock },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.round_started",
      data: {
        roundId: round.id,
        materialKey: material.key,
        materialName: material.name,
        lotCount,
        shock: drawnShock ? { title: drawnShock.title, description: drawnShock.description, appliedNote: shockNote } : null,
      },
    });

    return round;
  });
}

// All rounds a moderator can currently resume/open a lot in — every
// material round that's "active" (started, not yet fully sold through)
// whether or not it currently has a live lot, so a round that was
// paused to let another material run can be picked back up. Backs the
// "switch material, come back later" workflow: startRound no longer
// blocks a second material's round from starting just because an
// earlier one isn't finished (see startRound's per-material check
// above) — this is what the moderator console lists to pick from.
export async function listActiveRounds(eventId: string) {
  const rounds = await db
    .select({
      id: auctionRounds.id,
      materialTypeId: auctionRounds.materialTypeId,
      sequence: auctionRounds.sequence,
      startedAt: auctionRounds.startedAt,
      materialKey: materialTypes.key,
      materialName: materialTypes.name,
    })
    .from(auctionRounds)
    .innerJoin(materialTypes, eq(auctionRounds.materialTypeId, materialTypes.id))
    .where(and(eq(auctionRounds.eventId, eventId), eq(auctionRounds.status, "active")))
    .orderBy(auctionRounds.sequence);

  const roundIds = rounds.map((r) => r.id);
  const lotCounts = roundIds.length
    ? await db
        .select({ roundId: auctionLots.roundId, status: auctionLots.status, count: sql<number>`count(*)` })
        .from(auctionLots)
        .where(inArray(auctionLots.roundId, roundIds))
        .groupBy(auctionLots.roundId, auctionLots.status)
    : [];
  const countsByRound = new Map<string, Record<string, number>>();
  for (const row of lotCounts) {
    const entry = countsByRound.get(row.roundId) ?? {};
    entry[row.status] = Number(row.count);
    countsByRound.set(row.roundId, entry);
  }

  return rounds.map((r) => {
    const counts = countsByRound.get(r.id) ?? {};
    return {
      ...r,
      pendingLots: counts.pending ?? 0,
      liveLots: counts.live ?? 0,
    };
  });
}

// Rulebook v2 Reserved Kit: before open bidding starts on Bricks,
// Cement, or Steel, any team may claim exactly one lot of it at its
// printed opening price with no bidding, paid immediately. The window
// closes the moment the first open bid is called for that material —
// modeled here as "no lot in this round has ever left pending" (once
// openNextLot has run once, even if that lot hasn't closed yet, the
// window is shut). Claiming reassigns one of the round's already-
// generated pending lots directly (never manufactures extra supply)
// and counts toward the same Lot Cap as an auction win.
export async function claimReservedKit(params: {
  eventId: string;
  teamId: string;
  materialTypeId: string;
  actingParticipantId: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage1(tx, params.eventId);
    await assertTeamLeaderTx(tx, params.eventId, params.teamId, params.actingParticipantId);

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.status !== "active") throw new GameError("forbidden", "This team is not active.");

    const [material] = await tx.select().from(materialTypes).where(eq(materialTypes.id, params.materialTypeId));
    if (!material || material.eventId !== params.eventId) throw new GameError("not_found", "Material not found.");
    if (!material.reservedKitEligible) {
      throw new GameError("forbidden", `${material.name} does not carry a Reserved Kit right — only Bricks, Cement, and Steel do.`);
    }

    const [round] = await tx
      .select()
      .from(auctionRounds)
      .where(and(eq(auctionRounds.eventId, params.eventId), eq(auctionRounds.materialTypeId, material.id), eq(auctionRounds.status, "active")))
      .for("update");
    if (!round) throw new GameError("conflict", `${material.name}'s round isn't open right now.`);

    // "Ever left pending" is the wrong test here — a PREVIOUS Reserved
    // Kit claim (by this team or another) also moves a lot straight from
    // pending to closed without ever opening it for bidding, and must
    // not itself count as closing the window for every other team still
    // waiting to claim theirs. opensAt is only ever set by openNextLot,
    // so "has a lot in this round actually gone live" is the real
    // window-closing condition the rulebook describes.
    const [everOpened] = await tx
      .select({ id: auctionLots.id })
      .from(auctionLots)
      .where(and(eq(auctionLots.roundId, round.id), sql`${auctionLots.opensAt} is not null`))
      .limit(1);
    if (everOpened) {
      throw new GameError("conflict", "The Reserved Kit window has closed — open bidding has already started on this material.");
    }

    const [alreadyClaimed] = await tx
      .select({ id: materialLots.id })
      .from(materialLots)
      .where(
        and(
          eq(materialLots.eventId, params.eventId),
          eq(materialLots.materialTypeId, material.id),
          eq(materialLots.ownerTeamId, team.id),
          eq(materialLots.source, "reserved_kit"),
        ),
      );
    if (alreadyClaimed) {
      throw new GameError("conflict", `Your team has already claimed its Reserved Kit lot of ${material.name}.`);
    }

    const heldLots = await countTeamLotsOfMaterial(tx, params.eventId, team.id, material.id);
    if (heldLots >= LOT_CAP_PER_TEAM_PER_MATERIAL) {
      throw new GameError("lot_cap_reached", `Your team already holds the maximum ${LOT_CAP_PER_TEAM_PER_MATERIAL} lots of ${material.name}.`);
    }

    const [claimableLot] = await tx
      .select()
      .from(auctionLots)
      .where(and(eq(auctionLots.roundId, round.id), eq(auctionLots.status, "pending")))
      .orderBy(auctionLots.lotNumber)
      .limit(1);
    if (!claimableLot) throw new GameError("conflict", "No lots left to claim in this round.");

    if (team.auctionTokens < claimableLot.openingBid) {
      throw new GameError("insufficient_tokens", `Claiming this lot costs ${claimableLot.openingBid} tokens; your team only has ${team.auctionTokens}.`);
    }

    await tx.update(teams).set({ auctionTokens: team.auctionTokens - claimableLot.openingBid }).where(eq(teams.id, team.id));

    await tx
      .update(materialLots)
      .set({ status: "sold", ownerTeamId: team.id, source: "reserved_kit" })
      .where(eq(materialLots.id, claimableLot.materialLotId));

    await tx
      .update(auctionLots)
      .set({ status: "closed", winnerTeamId: team.id })
      .where(eq(auctionLots.id, claimableLot.id));

    const [materialLot] = await tx.select().from(materialLots).where(eq(materialLots.id, claimableLot.materialLotId));

    await tx.insert(teamInventoryTransactions).values({
      eventId: params.eventId,
      teamId: team.id,
      materialTypeId: material.id,
      quantityDelta: materialLot!.quantity,
      reason: "auction_win",
      relatedEntityType: "auction_lot",
      relatedEntityId: claimableLot.id,
      createdBy: params.actingParticipantId,
    });

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "reserved_kit.claimed",
      entityType: "auction_lot",
      entityId: claimableLot.id,
      afterJson: { teamId: team.id, materialKey: material.key, amount: claimableLot.openingBid },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.lot_closed",
      data: { auctionLotId: claimableLot.id, winnerTeamId: team.id, amount: claimableLot.openingBid, reservedKit: true },
    });

    await completeRoundIfFinished(tx, params.eventId, round.id);

    return { auctionLotId: claimableLot.id, materialKey: material.key, amount: claimableLot.openingBid, quantity: materialLot!.quantity };
  });
}

export async function openNextLot(params: { eventId: string; roundId: string; actorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage1(tx, params.eventId);
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    // Known gap since docs/phase-1.md, never fixed until now: this
    // function used to check "is another lot already live" with a plain
    // SELECT and no lock, so two concurrent open-next-lot calls (a
    // moderator double-clicking, or two staff accounts acting at once)
    // could both see no live lot and both proceed, opening two lots live
    // at once. Locking the EVENT row first (not just this round) serializes
    // any second concurrent call — on any round — behind the first's
    // commit, since with multiple rounds now able to sit "active" at once
    // (paused, mid-switch), the real constraint is event-wide: there is
    // only one live auction actually happening in the room at a time,
    // never two different materials' lots live simultaneously.
    await tx.select().from(events).where(eq(events.id, params.eventId)).for("update");

    const [stillLive] = await tx
      .select({ id: auctionLots.id })
      .from(auctionLots)
      .where(and(eq(auctionLots.eventId, params.eventId), eq(auctionLots.status, "live")));
    if (stillLive) {
      throw new GameError("conflict", "Close the current lot before opening the next one.");
    }

    const [nextLot] = await tx
      .select()
      .from(auctionLots)
      .where(and(eq(auctionLots.roundId, params.roundId), eq(auctionLots.status, "pending")))
      .orderBy(auctionLots.lotNumber)
      .limit(1);
    if (!nextLot) throw new GameError("not_found", "No pending lots left in this round.");

    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + settings.auctionLotDurationSeconds * 1000);

    const [updated] = await tx
      .update(auctionLots)
      .set({ status: "live", opensAt, closesAt })
      .where(eq(auctionLots.id, nextLot.id))
      .returning();

    await tx
      .update(materialLots)
      .set({ status: "auctioning" })
      .where(eq(materialLots.id, nextLot.materialLotId));

    // Marks this as "the" round currently live for the team-facing Live
    // Auction screen — see the comment on startRound about activeRoundId
    // no longer being set at round creation.
    await tx.update(events).set({ activeRoundId: params.roundId }).where(eq(events.id, params.eventId));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "auction_lot.opened",
      entityType: "auction_lot",
      entityId: updated.id,
      afterJson: updated,
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.lot_opened",
      data: updated,
    });

    return updated;
  });
}

export async function placeBid(params: {
  eventId: string;
  auctionLotId: string;
  teamId: string;
  actingParticipantId: string;
  amount: number;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage1(tx, params.eventId);
    await assertTeamLeaderTx(tx, params.eventId, params.teamId, params.actingParticipantId);

    // Lock the team row first, then the lot row, in a fixed order —
    // always team-then-lot — so two concurrent bids from the same team on
    // different lots (or a bid and a moderator close on the same lot)
    // can't deadlock each other by acquiring these two locks in reverse
    // order.
    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.status !== "active") throw new GameError("forbidden", "This team is not active.");

    const [lot] = await tx.select().from(auctionLots).where(eq(auctionLots.id, params.auctionLotId)).for("update");
    if (!lot || lot.eventId !== params.eventId) throw new GameError("not_found", "Auction lot not found.");
    if (lot.status !== "live") throw new GameError("lot_not_live", "This lot is not open for bidding.");
    if (lot.closesAt && lot.closesAt.getTime() < Date.now()) {
      throw new GameError("lot_not_live", "This lot's timer has already expired.");
    }

    const [materialLot] = await tx.select().from(materialLots).where(eq(materialLots.id, lot.materialLotId));
    if (!materialLot) throw new GameError("not_found", "Material lot not found.");

    // Rulebook v2 Lot Cap: a team already holding the cap's worth of
    // lots for this material is refused outright — the bid never enters
    // the auction at all, not even as a recorded losing bid (contrast
    // with the below-minimum/insufficient-funds cases, which ARE
    // recorded as rejected bids since those are genuine bid attempts on
    // a lot the team could still eventually win).
    const heldLots = await countTeamLotsOfMaterial(tx, params.eventId, team.id, materialLot.materialTypeId);
    if (heldLots >= LOT_CAP_PER_TEAM_PER_MATERIAL) {
      const [material] = await tx.select({ name: materialTypes.name }).from(materialTypes).where(eq(materialTypes.id, materialLot.materialTypeId));
      throw new GameError("lot_cap_reached", `Your team already holds the maximum ${LOT_CAP_PER_TEAM_PER_MATERIAL} lots of ${material?.name ?? "this material"}.`);
    }

    const [currentWinning] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.auctionLotId, lot.id), eq(bids.status, "winning")));

    const minimumBid = currentWinning ? currentWinning.amount + lot.minimumRaise : lot.openingBid;

    if (params.amount < minimumBid) {
      const [rejected] = await tx
        .insert(bids)
        .values({
          auctionLotId: lot.id,
          teamId: team.id,
          amount: params.amount,
          status: "rejected",
          rejectionReason: `Bid must be at least ${minimumBid} tokens.`,
        })
        .returning();
      return { accepted: false as const, bid: rejected };
    }

    if (params.amount > team.auctionTokens) {
      const [rejected] = await tx
        .insert(bids)
        .values({
          auctionLotId: lot.id,
          teamId: team.id,
          amount: params.amount,
          status: "rejected",
          rejectionReason: "Insufficient auction tokens.",
        })
        .returning();
      return { accepted: false as const, bid: rejected };
    }

    if (currentWinning) {
      await tx.update(bids).set({ status: "outbid" }).where(eq(bids.id, currentWinning.id));
    }

    const [accepted] = await tx
      .insert(bids)
      .values({ auctionLotId: lot.id, teamId: team.id, amount: params.amount, status: "winning" })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "bid.accepted",
      entityType: "bid",
      entityId: accepted.id,
      afterJson: accepted,
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.bid_accepted",
      data: { auctionLotId: lot.id, teamId: team.id, amount: params.amount },
    });

    return { accepted: true as const, bid: accepted };
  });
}

// Section 6.3. `actorParticipantId: null` means the timer closed it, not a
// moderator click — recordAudit only requires a reason when there IS an
// actor, so a timer-driven close doesn't need to invent one.
export async function closeLot(params: {
  eventId: string;
  auctionLotId: string;
  actorParticipantId: string | null;
  reason?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    // null means the timer sweep closed it, not a person — see
    // closeExpiredLots below. Anyone else must be staff.
    if (params.actorParticipantId !== null) {
      await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    }

    const [lot] = await tx.select().from(auctionLots).where(eq(auctionLots.id, params.auctionLotId)).for("update");
    if (!lot || lot.eventId !== params.eventId) throw new GameError("not_found", "Auction lot not found.");
    if (lot.status !== "live") throw new GameError("conflict", "Only a live lot can be closed.");

    // No lot is live anywhere in the event once this one closes — clear
    // the "currently live round" pointer so the moderator console shows
    // no live auction until the next openNextLot call (on this round or
    // a different one) sets it again.
    await tx.update(events).set({ activeRoundId: null }).where(and(eq(events.id, params.eventId), eq(events.activeRoundId, lot.roundId)));

    const [winningBid] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.auctionLotId, lot.id), eq(bids.status, "winning")));

    const [materialLot] = await tx.select().from(materialLots).where(eq(materialLots.id, lot.materialLotId));
    if (!materialLot) throw new GameError("not_found", "Material lot not found.");

    if (!winningBid) {
      await tx.update(auctionLots).set({ status: "unsold" }).where(eq(auctionLots.id, lot.id));
      await tx.update(materialLots).set({ status: "bank_stock" }).where(eq(materialLots.id, materialLot.id));

      await recordAudit(tx, {
        eventId: params.eventId,
        actorParticipantId: params.actorParticipantId,
        reason: params.reason ?? "Lot closed with no bids.",
        isOverride: Boolean(params.actorParticipantId),
        action: "auction_lot.unsold",
        entityType: "auction_lot",
        entityId: lot.id,
      });

      queueBroadcast({
        eventId: params.eventId,
        type: "auction.lot_closed",
        data: { auctionLotId: lot.id, winnerTeamId: null },
      });

      await completeRoundIfFinished(tx, params.eventId, lot.roundId);
      return { winnerTeamId: null as string | null };
    }

    const [team] = await tx.select().from(teams).where(eq(teams.id, winningBid.teamId)).for("update");
    if (!team) throw new GameError("not_found", "Winning team not found.");
    if (team.auctionTokens < winningBid.amount || team.status !== "active") {
      // Rulebook contingencies: "A team can't pay its bid: void the bid,
      // re-offer the lot immediately" AND "A team drops out mid-game:
      // remove its unsold materials" — both land here, since a withdrawn/
      // disqualified team's in-flight winning bid must never settle just
      // because it happened to be leading when the lot closed. Re-offer
      // itself is a moderator action (incident-service.ts's reopenLot);
      // this only guarantees the lot never settles to an invalid winner.
      await tx.update(bids).set({ status: "voided" }).where(eq(bids.id, winningBid.id));
      await tx.update(auctionLots).set({ status: "unsold" }).where(eq(auctionLots.id, lot.id));
      await tx.update(materialLots).set({ status: "bank_stock" }).where(eq(materialLots.id, materialLot.id));

      await recordAudit(tx, {
        eventId: params.eventId,
        actorParticipantId: params.actorParticipantId,
        reason:
          team.status !== "active"
            ? `Winning team is no longer active (${team.status}).`
            : "Winning team could not cover its bid at close.",
        isOverride: true,
        action: "bid.voided_insufficient_funds",
        entityType: "bid",
        entityId: winningBid.id,
      });

      queueBroadcast({
        eventId: params.eventId,
        type: "auction.lot_closed",
        data: { auctionLotId: lot.id, winnerTeamId: null, voidedForNonPayment: true },
      });

      await completeRoundIfFinished(tx, params.eventId, lot.roundId);
      return { winnerTeamId: null as string | null };
    }

    await tx
      .update(teams)
      .set({ auctionTokens: team.auctionTokens - winningBid.amount })
      .where(eq(teams.id, team.id));

    await tx.update(materialLots).set({ status: "sold", ownerTeamId: team.id }).where(eq(materialLots.id, materialLot.id));

    await tx.insert(teamInventoryTransactions).values({
      eventId: params.eventId,
      teamId: team.id,
      materialTypeId: materialLot.materialTypeId,
      quantityDelta: materialLot.quantity,
      reason: "auction_win",
      relatedEntityType: "auction_lot",
      relatedEntityId: lot.id,
      createdBy: params.actorParticipantId,
    });

    // Eco Incentive automation: this round drew the shock and its
    // material matched (auction_rounds.eco_bonus_override set) — credit
    // the winner's eco-eligible Solar count so constructBuilding can
    // automatically grant +15 instead of the standard +10 later, with no
    // moderator step required. Capped at usage time by current holdings
    // (building-service.ts), so trading this Solar away can't be used to
    // bank the credit for different Solar later.
    const [round] = await tx.select({ ecoBonusOverride: auctionRounds.ecoBonusOverride }).from(auctionRounds).where(eq(auctionRounds.id, lot.roundId));
    if (round?.ecoBonusOverride) {
      await tx
        .update(teams)
        .set({ ecoEligibleSolarUnits: team.ecoEligibleSolarUnits + materialLot.quantity })
        .where(eq(teams.id, team.id));
    }

    await tx
      .update(auctionLots)
      .set({ status: "closed", winningBidId: winningBid.id, winnerTeamId: team.id })
      .where(eq(auctionLots.id, lot.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      action: "auction_lot.closed",
      entityType: "auction_lot",
      entityId: lot.id,
      afterJson: { winnerTeamId: team.id, amount: winningBid.amount },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.lot_closed",
      data: { auctionLotId: lot.id, winnerTeamId: team.id, amount: winningBid.amount },
    });

    await completeRoundIfFinished(tx, params.eventId, lot.roundId);
    return { winnerTeamId: team.id as string | null };
  });
}

// Section 5.3: "opens_at, closes_at — The authoritative timer." Nothing
// client-side is trusted to decide a lot is over; something server-side
// has to actually notice closesAt has passed and call closeLot. This sweep
// is that "something" — see backend/src/index.ts, which is the one
// long-running process able to poll it on an interval (Section 9 Phase
// 2's "moderator round and lot control" implicitly needs this for lots
// the moderator doesn't manually close in time).
export async function closeExpiredLots(): Promise<{ closedLotIds: string[] }> {
  const expired = await db
    .select({ id: auctionLots.id, eventId: auctionLots.eventId })
    .from(auctionLots)
    .where(and(eq(auctionLots.status, "live"), sql`${auctionLots.closesAt} < now()`));

  const closedLotIds: string[] = [];
  for (const lot of expired) {
    try {
      await closeLot({ eventId: lot.eventId, auctionLotId: lot.id, actorParticipantId: null });
      closedLotIds.push(lot.id);
    } catch (err) {
      // One lot's sweep failing (e.g. it was just closed manually a
      // moment ago and no longer matches) must never stop the others from
      // being checked.
      console.error("closeExpiredLots: failed to close lot", lot.id, err);
    }
  }
  return { closedLotIds };
}
