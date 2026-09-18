import { db, eq, and, sql } from "db";
import { events, eventSettings, teams, cities, cityAuctions, cityBids } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { assertTeamLeaderTx, assertStaffTx } from "./team-service";

// Rulebook Stage 3 "The City Auction and Scoring": "Each team gets a
// sealed City Wallet of 500 tokens (usable only now), plus any tokens left
// from earlier. Bidding power = wallet + leftovers... One city per team.
// Cities are sold one at a time. Win one and you stop bidding... Raise by
// at least 25 tokens, never beyond your bidding power."
//
// hidden_multiplier is never selected by anything in this file. Every
// query here returns a `cities` row shape that omits it entirely — see
// publicCityColumns — so there is no code path through this service that
// could leak it pre-reveal, not even accidentally via a `select()` that
// forgot to strip a field.
const publicCityColumns = {
  id: cities.id,
  eventId: cities.eventId,
  blockNumber: cities.blockNumber,
  name: cities.name,
  tier: cities.tier,
  openingBid: cities.openingBid,
  isTrap: cities.isTrap,
  isSleeper: cities.isSleeper,
  revealState: cities.revealState,
  assignedTeamId: cities.assignedTeamId,
  saleOrder: cities.saleOrder,
} as const;

export async function listCities(eventId: string) {
  const rows = await db.select(publicCityColumns).from(cities).where(eq(cities.eventId, eventId));
  // isTrap/isSleeper are moderator-authoring metadata (Appendix C labels),
  // not something a team should see before reveal either — strip them
  // here rather than trust every future caller of listCities to remember.
  return rows.map((r) => ({
    ...r,
    isTrap: r.revealState === "revealed" ? r.isTrap : undefined,
    isSleeper: r.revealState === "revealed" ? r.isSleeper : undefined,
  }));
}

async function assertStage3(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_3") {
    throw new GameError("invalid_event_stage", "The city auction only happens during Stage 3.");
  }
}

async function assertTeamHasNoCity(tx: Tx, eventId: string, teamId: string) {
  const [owned] = await tx
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.eventId, eventId), eq(cities.assignedTeamId, teamId)));
  if (owned) throw new GameError("already_has_city", "This team already won a city and cannot bid again.");
}

export async function startCityAuction(params: { eventId: string; cityId: string; actorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage3(tx, params.eventId);
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [existingLive] = await tx
      .select({ id: cityAuctions.id })
      .from(cityAuctions)
      .where(and(eq(cityAuctions.eventId, params.eventId), eq(cityAuctions.status, "live")));
    if (existingLive) throw new GameError("conflict", "Another city auction is already live.");

    const [city] = await tx.select().from(cities).where(eq(cities.id, params.cityId));
    if (!city || city.eventId !== params.eventId) throw new GameError("not_found", "City not found.");
    if (city.assignedTeamId) throw new GameError("conflict", "This city has already been assigned.");

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + settings.cityAuctionDurationSeconds * 1000);

    const [auction] = await tx
      .insert(cityAuctions)
      .values({
        eventId: params.eventId,
        cityId: city.id,
        status: "live",
        openingBid: city.openingBid,
        minimumRaise: settings.cityMinimumRaise,
        opensAt,
        closesAt,
      })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "city_auction.started",
      entityType: "city_auction",
      entityId: auction.id,
      afterJson: auction,
    });

    // City tier/opening bid are public; the multiplier stays out of this
    // payload entirely (see publicCityColumns).
    queueBroadcast({
      eventId: params.eventId,
      type: "city.auction_opened",
      data: { auctionId: auction.id, cityId: city.id, cityName: city.name, tier: city.tier, openingBid: city.openingBid },
    });

    return auction;
  });
}

export async function placeCityBid(params: {
  eventId: string;
  cityAuctionId: string;
  teamId: string;
  actingParticipantId: string;
  amount: number;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage3(tx, params.eventId);
    await assertTeamLeaderTx(tx, params.eventId, params.teamId, params.actingParticipantId);

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.status !== "active") throw new GameError("forbidden", "This team is not active.");
    await assertTeamHasNoCity(tx, params.eventId, team.id);

    const [auction] = await tx.select().from(cityAuctions).where(eq(cityAuctions.id, params.cityAuctionId)).for("update");
    if (!auction || auction.eventId !== params.eventId) throw new GameError("not_found", "City auction not found.");
    if (auction.status !== "live") throw new GameError("lot_not_live", "This city auction is not open for bidding.");
    if (auction.closesAt && auction.closesAt.getTime() < Date.now()) {
      throw new GameError("lot_not_live", "This city auction's timer has already expired.");
    }

    const [currentWinning] = await tx
      .select()
      .from(cityBids)
      .where(and(eq(cityBids.cityAuctionId, auction.id), eq(cityBids.status, "winning")));

    const minimumBid = currentWinning ? currentWinning.amount + auction.minimumRaise : auction.openingBid;
    const biddingPower = team.cityWalletTokens + team.auctionTokens;

    if (params.amount < minimumBid) {
      const [rejected] = await tx
        .insert(cityBids)
        .values({
          cityAuctionId: auction.id,
          teamId: team.id,
          amount: params.amount,
          cityWalletUsed: 0,
          auctionTokensUsed: 0,
          status: "rejected",
        })
        .returning();
      return { accepted: false as const, bid: rejected, reason: `Bid must be at least ${minimumBid} tokens.` };
    }

    if (params.amount > biddingPower) {
      const [rejected] = await tx
        .insert(cityBids)
        .values({
          cityAuctionId: auction.id,
          teamId: team.id,
          amount: params.amount,
          cityWalletUsed: 0,
          auctionTokensUsed: 0,
          status: "rejected",
        })
        .returning();
      return { accepted: false as const, bid: rejected, reason: "Bid exceeds this team's bidding power (city wallet + leftover tokens)." };
    }

    // City wallet spent first, leftover auction tokens cover the rest —
    // rulebook: "Bidding power = wallet + leftovers." Which pool actually
    // gets debited only matters at settlement (closeCityAuction); this
    // split is fixed now so it can't be recomputed differently (and
    // differently) at close time.
    const cityWalletUsed = Math.min(params.amount, team.cityWalletTokens);
    const auctionTokensUsed = params.amount - cityWalletUsed;

    if (currentWinning) {
      await tx.update(cityBids).set({ status: "outbid" }).where(eq(cityBids.id, currentWinning.id));
    }

    const [accepted] = await tx
      .insert(cityBids)
      .values({ cityAuctionId: auction.id, teamId: team.id, amount: params.amount, cityWalletUsed, auctionTokensUsed, status: "winning" })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "city_bid.accepted",
      entityType: "city_bid",
      entityId: accepted.id,
      afterJson: accepted,
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "city.bid_accepted",
      data: { cityAuctionId: auction.id, teamId: team.id, amount: params.amount },
    });

    return { accepted: true as const, bid: accepted };
  });
}

async function settleCityAuction(
  tx: Tx,
  params: { eventId: string; auction: typeof cityAuctions.$inferSelect; winningBid: typeof cityBids.$inferSelect | undefined; actorParticipantId: string | null },
) {
  const [city] = await tx.select().from(cities).where(eq(cities.id, params.auction.cityId));
  if (!city) throw new GameError("not_found", "City not found.");

  if (!params.winningBid) {
    await tx.update(cityAuctions).set({ status: "closed" }).where(eq(cityAuctions.id, params.auction.id));
    return { winnerTeamId: null as string | null, cityId: city.id };
  }

  const [team] = await tx.select().from(teams).where(eq(teams.id, params.winningBid.teamId)).for("update");
  if (!team) throw new GameError("not_found", "Winning team not found.");
  // Rulebook v3 Contingency #6: "a team wins a city but can't pay" -
  // void the bid and close the auction unsold (Stage-1-consistent: the
  // moderator re-offers the city by starting its auction again, the
  // same recovery path as closeLot's insufficient-funds case; nothing
  // here forces the harsher outright-disqualification some sources
  // suggested). team.status !== "active" covers a team that
  // withdrew/was disqualified mid-auction; the balance check covers a
  // team whose balance dropped below the bid between placing it and
  // this settlement (e.g. a moderator adjustment, or a concurrent
  // spend) - placeCityBid already checks affordability AT BID TIME, but
  // never re-checks it here, so without this a settlement could
  // silently drive a team's tokens negative instead of catching it.
  const canAfford = team.cityWalletTokens >= params.winningBid.cityWalletUsed && team.auctionTokens >= params.winningBid.auctionTokensUsed;
  if (team.status !== "active" || !canAfford) {
    await tx.update(cityBids).set({ status: "voided" }).where(eq(cityBids.id, params.winningBid.id));
    await tx.update(cityAuctions).set({ status: "closed" }).where(eq(cityAuctions.id, params.auction.id));
    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: team.status !== "active" ? `Winning team is no longer active (${team.status}).` : "Winning team could not cover its bid at settlement.",
      isOverride: true,
      action: team.status !== "active" ? "city_bid.voided_team_inactive" : "city_bid.voided_insufficient_funds",
      entityType: "city_bid",
      entityId: params.winningBid.id,
    });
    return { winnerTeamId: null as string | null, cityId: city.id };
  }

  const [nextSaleOrder] = await tx
    .select({ n: sql<number>`coalesce(max(${cities.saleOrder}), 0)` })
    .from(cities)
    .where(eq(cities.eventId, params.eventId));

  await tx
    .update(teams)
    .set({
      cityWalletTokens: team.cityWalletTokens - params.winningBid.cityWalletUsed,
      auctionTokens: team.auctionTokens - params.winningBid.auctionTokensUsed,
    })
    .where(eq(teams.id, team.id));

  await tx
    .update(cities)
    .set({ assignedTeamId: team.id, saleOrder: (nextSaleOrder?.n ?? 0) + 1 })
    .where(eq(cities.id, city.id));

  await tx
    .update(cityAuctions)
    .set({ status: "closed", winnerTeamId: team.id, winningBidId: params.winningBid.id })
    .where(eq(cityAuctions.id, params.auction.id));

  await recordAudit(tx, {
    eventId: params.eventId,
    actorParticipantId: params.actorParticipantId,
    reason: params.actorParticipantId ? "City auction closed." : undefined,
    action: "city.assigned",
    entityType: "city",
    entityId: city.id,
    afterJson: { winnerTeamId: team.id, amount: params.winningBid.amount },
  });

  return { winnerTeamId: team.id as string | null, cityId: city.id };
}

export async function closeCityAuction(params: { eventId: string; cityAuctionId: string; actorParticipantId: string | null }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    if (params.actorParticipantId !== null) {
      await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    }

    const [auction] = await tx.select().from(cityAuctions).where(eq(cityAuctions.id, params.cityAuctionId)).for("update");
    if (!auction || auction.eventId !== params.eventId) throw new GameError("not_found", "City auction not found.");
    if (auction.status !== "live") throw new GameError("conflict", "Only a live city auction can be closed.");

    const [winningBid] = await tx
      .select()
      .from(cityBids)
      .where(and(eq(cityBids.cityAuctionId, auction.id), eq(cityBids.status, "winning")));

    const result = await settleCityAuction(tx, { eventId: params.eventId, auction, winningBid, actorParticipantId: params.actorParticipantId });
    // Always broadcast something on close, not just when there's a
    // winner — an auction that times out with no bids (or that the
    // timer sweep closed because a moderator missed the window) used to
    // close silently, leaving every connected screen still showing it
    // as "live" with an actionable Close button. Clicking that stale
    // button then failed with "Only a live city auction can be closed"
    // and nothing on screen explained why or fixed itself. This event
    // triggers the same refresh() every screen already runs on any
    // broadcast, so a closed auction disappears from "live" everywhere
    // within moments regardless of whether it sold.
    queueBroadcast({ eventId: params.eventId, type: "city.auction_closed", data: { cityAuctionId: auction.id, cityId: auction.cityId, winnerTeamId: result.winnerTeamId } });
    if (result.winnerTeamId) {
      queueBroadcast({ eventId: params.eventId, type: "city.assigned", data: result });
    }
    return result;
  });
}

// Rulebook: "the last team takes the last remaining city for a minimum
// base point." Read literally, once there is exactly one team without a
// city and exactly one city unsold, no further bidding is meaningful — the
// moderator invokes this directly rather than running an auction nobody
// can lose. Charged at the city's opening bid (the "minimum base"), split
// wallet-then-leftover the same way a normal winning bid would be.
export async function assignLastCity(params: { eventId: string; cityId: string; teamId: string; actorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage3(tx, params.eventId);
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [city] = await tx.select().from(cities).where(eq(cities.id, params.cityId)).for("update");
    if (!city || city.eventId !== params.eventId) throw new GameError("not_found", "City not found.");
    if (city.assignedTeamId) throw new GameError("conflict", "This city has already been assigned.");

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    await assertTeamHasNoCity(tx, params.eventId, team.id);

    // Verify this is genuinely "the last team, the last city" — not just
    // trusted to the moderator's word. Without this check, assignLastCity
    // would let a moderator hand any city to any team at opening bid at
    // any point in Stage 3, bypassing the auction entirely.
    const allCities = await tx.select().from(cities).where(eq(cities.eventId, params.eventId));
    const unassignedCities = allCities.filter((c) => !c.assignedTeamId);
    const activeTeams = await tx.select().from(teams).where(and(eq(teams.eventId, params.eventId), eq(teams.status, "active")));
    const teamsWithoutCity = activeTeams.filter((t) => !allCities.some((c) => c.assignedTeamId === t.id));

    if (unassignedCities.length !== 1 || teamsWithoutCity.length !== 1) {
      throw new GameError(
        "conflict",
        `This is only for the last team/last city situation (currently ${teamsWithoutCity.length} team(s) without a city, ` +
          `${unassignedCities.length} unsold cit${unassignedCities.length === 1 ? "y" : "ies"}) — run a normal auction instead.`,
      );
    }
    if (teamsWithoutCity[0].id !== team.id || unassignedCities[0].id !== city.id) {
      throw new GameError("conflict", "This is not the one remaining team/city pair.");
    }

    const amount = city.openingBid;
    const cityWalletUsed = Math.min(amount, team.cityWalletTokens);
    const auctionTokensUsed = amount - cityWalletUsed;
    if (auctionTokensUsed > team.auctionTokens) {
      throw new GameError("insufficient_tokens", "Team cannot cover even the city's opening bid.");
    }

    const [auction] = await tx
      .insert(cityAuctions)
      .values({ eventId: params.eventId, cityId: city.id, status: "closed", openingBid: city.openingBid, minimumRaise: 0, opensAt: new Date(), closesAt: new Date() })
      .returning();
    const [winningBid] = await tx
      .insert(cityBids)
      .values({ cityAuctionId: auction.id, teamId: team.id, amount, cityWalletUsed, auctionTokensUsed, status: "winning" })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: "Last team, last city — assigned at opening bid per rulebook contingency.",
      isOverride: true,
      action: "city.last_team_assignment",
      entityType: "city",
      entityId: city.id,
    });

    const result = await settleCityAuction(tx, {
      eventId: params.eventId,
      auction: { ...auction, winnerTeamId: null, winningBidId: null },
      winningBid,
      actorParticipantId: params.actorParticipantId,
    });
    queueBroadcast({ eventId: params.eventId, type: "city.assigned", data: result });
    return result;
  });
}

// Lets a moderator directly sell a specific city to a specific team at a
// specific price — for handling an in-person/paper bid, correcting a
// mistake, or any other situation where running a live timed auction
// through this app isn't how that city actually got decided. Not
// restricted to the "last team, last city" case assignLastCity covers,
// and not fixed to the city's opening bid either — the moderator sets
// the amount, same as a real winning bid would have. The one rule that
// still can't be overridden: the team must actually be able to afford
// it (city wallet + leftover Stage 1 tokens), same affordability check
// placeCityBid enforces on a live bid.
export async function sellCityToTeam(params: {
  eventId: string;
  cityId: string;
  teamId: string;
  amount: number;
  actorParticipantId: string;
  reason?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage3(tx, params.eventId);
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    if (!Number.isInteger(params.amount) || params.amount < 0) {
      throw new GameError("invalid_input", "Sale amount must be a non-negative whole number.");
    }

    const [city] = await tx.select().from(cities).where(eq(cities.id, params.cityId)).for("update");
    if (!city || city.eventId !== params.eventId) throw new GameError("not_found", "City not found.");
    if (city.assignedTeamId) throw new GameError("conflict", "This city has already been assigned.");

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.status !== "active") throw new GameError("forbidden", "This team is not active.");
    await assertTeamHasNoCity(tx, params.eventId, team.id);

    const biddingPower = team.cityWalletTokens + team.auctionTokens;
    if (params.amount > biddingPower) {
      throw new GameError("insufficient_tokens", `This team's bidding power (city wallet + leftover tokens) is only ${biddingPower}, less than the ${params.amount} sale price.`);
    }

    const cityWalletUsed = Math.min(params.amount, team.cityWalletTokens);
    const auctionTokensUsed = params.amount - cityWalletUsed;

    const [auction] = await tx
      .insert(cityAuctions)
      .values({ eventId: params.eventId, cityId: city.id, status: "closed", openingBid: city.openingBid, minimumRaise: 0, opensAt: new Date(), closesAt: new Date() })
      .returning();
    const [winningBid] = await tx
      .insert(cityBids)
      .values({ cityAuctionId: auction.id, teamId: team.id, amount: params.amount, cityWalletUsed, auctionTokensUsed, status: "winning" })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "city.manual_sale",
      entityType: "city",
      entityId: city.id,
      afterJson: { teamId: team.id, amount: params.amount },
    });

    const result = await settleCityAuction(tx, {
      eventId: params.eventId,
      auction: { ...auction, winnerTeamId: null, winningBidId: null },
      winningBid,
      actorParticipantId: params.actorParticipantId,
    });
    queueBroadcast({ eventId: params.eventId, type: "city.assigned", data: result });
    return result;
  });
}

// Mirrors auction-service.ts's closeExpiredLots — same reasoning: nothing
// client-side is trusted to decide a city auction's timer expired, and
// backend/'s sweep is the one long-running process that can poll it.
export async function closeExpiredCityAuctions(): Promise<{ closedAuctionIds: string[] }> {
  const expired = await db
    .select({ id: cityAuctions.id, eventId: cityAuctions.eventId })
    .from(cityAuctions)
    .where(and(eq(cityAuctions.status, "live"), sql`${cityAuctions.closesAt} < now()`));

  const closedAuctionIds: string[] = [];
  for (const auction of expired) {
    try {
      await closeCityAuction({ eventId: auction.eventId, cityAuctionId: auction.id, actorParticipantId: null });
      closedAuctionIds.push(auction.id);
    } catch (err) {
      console.error("closeExpiredCityAuctions: failed to close auction", auction.id, err);
    }
  }
  return { closedAuctionIds };
}
