# Phase 4 — Stage 3: cities, scoring, and tiebreakers

## What changed

- **`packages/game-engine/src/city-service.ts`** — city auction, one lot
  (city) at a time, same shape as Stage 1's auction (row-locked, snapshot
  opening bid/min raise, live/closed lifecycle). `listCities` never
  selects `hidden_multiplier` at all — the column isn't in the query, so
  there's no code path in this file that could leak it, not even by a
  future edit forgetting to strip a field before responding. Bidding power
  is wallet + leftover auction tokens, split wallet-first at bid time (not
  recomputed differently at settlement), and a team that already won a
  city is rejected from bidding again (`already_has_city`).
- **`assignLastCity`** — the rulebook's "the last team takes the last
  remaining city for a minimum base point" contingency, implemented as an
  explicit moderator action (not auto-triggered) that assigns a city at its
  opening bid with no bidding round, logged as an override with a reason.
- **`scout-report-service.ts`** — 100-token clue, capped at
  `event_settings.scoutReportLimit` (2) per team, one report per team per
  city. The clue is derived from the real `hidden_multiplier` but only a
  rounded threshold (`minimum_multiplier`/`maximum_multiplier` +
  `clueValue`) is ever stored or returned — never logged in the audit
  trail either, even though a moderator can read audit entries.
- **`scoring-service.ts`** — `revealCitiesAndScore` runs the whole of
  Section 6.6 as one atomic transaction: verifies every active team has a
  city, flips every city to `revealed`, computes each team's building
  points / bonus points / optional leftover points, multiplies by their
  city's real multiplier (or applies the optional advanced/preferred-type
  formula), sorts with the exact three-step tiebreaker order (most
  buildings → most valuable single building → most unspent tokens),
  persists one `score_snapshots` row per team with a `calculationJson` that
  reproduces the whole formula, and marks the event `completed`.
  `getPreRevealScore` backs the Section 7.7 "before reveal" portfolio view
  (building + bonus + leftover points, no multiplier, city name/tier
  without its number).
- **8 new tests, 25 total, still against real Postgres**: hidden
  multiplier never appears in `listCities`'s output shape at all (checked
  via `not.toHaveProperty`, not just "value is undefined"); one-city-per-
  team enforcement; wallet-then-leftover payment split; last-team/last-
  city assignment; a scout report's clue is always true relative to the
  real multiplier and never the exact value; the scout report limit;
  reproducible scoring math for two different multipliers; and a
  genuinely tied final score broken correctly by building count.
- **10 new API routes**, including the exact `POST /events/:id/cities/
  reveal` path named in Section 8.1. 32 routes total now; full `next
  build` passes clean.
- **`closeExpiredCityAuctions`** — the same timer-sweep pattern Phase 2
  built for Stage 1 lots (`closeExpiredLots`), extended to
  `city_auctions.closes_at`. `backend/`'s existing 2-second sweep interval
  now calls both. Caught in review while writing this doc's first draft
  (the gap was about to be filed under "still deferred" below before it
  got fixed instead) — a 26th test confirms an expired city auction
  settles correctly through the sweep.

## Deviations, called out plainly

- **Reveal and scoring are one atomic action, not staged steps.** The
  plan's Section 6.6 workflow reads as a sequence ("reveal multipliers →
  ... → apply multiplier → sort → persist → publish"), and Section 5.2's
  `event_status` enum has both `scoring` and `completed` as if there's a
  window between them. Nothing meaningful can happen inside that window —
  once every city is revealed the final table is just arithmetic, not a
  place for moderator judgment calls — so `revealCitiesAndScore` collapses
  it into one transaction and jumps straight to `completed`. If you want a
  real intermediate "scoring in progress, standings not yet public"
  window (e.g. to walk through the reveal live, city by city, before
  publishing final numbers), that's a bigger change — flagging it now
  rather than assuming the collapsed version is what you want for a live
  event.
- **Advanced city scoring's leftover-points handling is undefined by the
  rulebook and I picked one interpretation.** Standard scoring multiplies
  `(buildingPoints + bonusPoints + leftoverPoints)` by the city multiplier
  — Section 6.6 says leftover is applied before the multiplier. Advanced
  scoring only multiplies *preferred-type* building points and leaves
  everything else at ×1 — but leftover materials aren't tied to any
  building type, so there's no natural slot for them in that formula. I
  added leftover points as a flat, unmultiplied addition in advanced mode.
  This is a judgment call on an underspecified interaction, not something
  the rulebook states either way.
- **Scout reports are capped at one per team per city** (in addition to
  the rulebook's stated "maximum two per team" overall). The rulebook
  doesn't explicitly forbid buying two reports on the same city, but
  allowing it would let a team narrow a single city's multiplier much
  further than a single clue ever could (an "at least X" and a "below
  X+0.5" on the same city, back to back, could pin the value down tightly
  since multipliers are seeded at exactly 0.5 increments) — this cap
  keeps each of a team's two reports meaningfully spent on two different
  cities. Reconsider if you want same-city re-scouting allowed.

## What's still deferred

- No Stage 3 UI screens yet (Section 7.6 City Auction, Section 7.7
  Portfolio/Score) — same call as Phase 3's Trade & Build screen: the
  engine, its authorization, and its tests came first. Two full frontend
  passes (Phase 2's Stage 1 screens, and Phase 3+4's still-missing
  screens) is a good chunk of remaining work before a live rehearsal.
- Phase 5 (event rehearsal and operational hardening: reconnects,
  concurrent bids, void/reopen, dropout handling, moderator quick guide,
  backup score sheet) hasn't started. Timer expiry itself is now covered
  for both Stage 1 lots and Stage 3 city auctions.

## What's left for you

- The two deviations above (reveal/score collapsed into one step;
  advanced-mode leftover handling) are genuine judgment calls on
  underspecified rulebook mechanics — say if either should work
  differently before Phase 5 hardening builds more on top of them.
