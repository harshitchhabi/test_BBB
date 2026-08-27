# Phase 5 — Event rehearsal and operational hardening

## What changed

- **`packages/game-engine/src/incident-service.ts`** — the Section 7.9
  "Incident Console" and CONTINGENCIES-chapter actions that didn't exist
  yet: `setTeamStatus` (withdraw/disqualify/reactivate — releasing any
  city the team held, per "remove its unsold materials and any city it
  holds"), `adjustTeamTokens` (manual balance correction, refuses to go
  negative), `voidBid` (a disputed/mistaken bid, without silently
  resurrecting a previous bidder as the new leader — "the moderator's
  call is final" stays a human decision), and `reopenLot` (the big one:
  fully reverses an already-settled sale — refunds the winner's tokens,
  reverses the inventory credit via an equal-and-opposite ledger entry
  that's inserted, never edited or deleted, and puts the material lot back
  up for auction). Every one of these is a moderator override, so every
  one requires a reason and logs before/after state.
- **Two defensive fixes in the existing settlement code**, found while
  building `setTeamStatus`: `closeLot` and `closeCityAuction` previously
  only checked "can this team afford it," not "is this team still
  active" — so a team withdrawn or disqualified *after* placing what was
  the winning bid, but *before* the lot/auction closed, would have still
  won it. Both now treat an inactive winning team exactly like a
  can't-pay scenario: the bid voids, the lot/city stays unsold, nothing
  settles to an invalid winner.
- **Reconnect fix in the frontend**: the team and moderator screens
  refetched their read model on receiving a WebSocket broadcast, but not
  on the socket itself reconnecting after a drop — so a connection that
  died and came back with no broadcast happening to arrive afterward
  could leave a screen showing stale state indefinitely. Both screens now
  refetch the instant `useEventSocket` reports `connected: true` again,
  independent of whether a message follows. This is the concrete fix for
  the rehearsal scenario "a server or browser restarts during a live
  lot" as far as the client is concerned; server-side, nothing new was
  needed — every mutation was already durable in Postgres from Phase 1
  onward, so a backend/frontend process restart never loses state, only
  a client's *view* of it needed this fix.
- **6 new tests, 32 total, still against real Postgres**: void-then-
  reopen a can't-pay lot and resell it cleanly; a fully reversed
  already-settled sale (refund + ledger reversal both verified); a
  withdrawn team's in-flight winning bid failing to settle; a withdrawn
  team's held city being released; a balance adjustment that's refused
  when it would go negative; every incident action rejected from a
  non-staff participant.
- **4 new command routes** (team status, adjust tokens, void bid, reopen
  lot) plus **2 export routes** — `GET /events/:id/exports/standings` and
  `.../exports/audit-log`, both CSV by default (`?format=json` for JSON),
  moderator-only. 38 routes total; full `next build` passes clean.
- **`docs/moderator-quick-guide.md`** — the Phase 5 deliverable itself: a
  one-page-per-situation guide mapping the rulebook's own CONTINGENCIES
  chapter to the actual command each row means, plus the setup checklist
  and stage-by-stage run sheet.

## What Phase 5's acceptance bar looks like against what actually exists

Section 9's Phase 5 acceptance check is "moderators can handle the
rulebook contingencies without changing the database manually." Going
through the CONTINGENCIES chapter row by row:

| Rulebook contingency | Covered by |
|---|---|
| Team can't pay its bid | `closeLot`'s existing can't-pay path (Phase 1) + `reopenLot` to re-offer |
| Disputed/tied bid | `voidBid`; the re-bid/coin-flip judgment itself is intentionally left to the moderator, not automated |
| Dead auction (no bids) | Timer expiry already unsells it (Phase 2); `reopenLot` if you want to re-offer it |
| Cheating / hidden materials found | `voidBuilding` (Phase 3) or an Inspection (Phase 3) |
| Reneged handshake trade | By design, not a system concern — handshake trades never entered the system in the first place (Phase 3) |
| Fake/altered Deed | Cross-check against `constructed_buildings`/the audit log export — no special command needed, the ledger itself is the master log |
| Team drops out mid-game | `setTeamStatus` |
| More/fewer teams than planned | Add/remove `material_types` kits and city blocks in seed data (Phase 0 concern, not runtime) |
| Running out of time (the cut-list) | `event_settings` toggles (`inspections_enabled`, `scout_reports_enabled`) + duration fields, all already moderator-configurable — no new code needed, just documented in the quick guide |

Every row resolves to an existing command or a documented non-concern —
nothing on this list required a direct database edit to handle.

## Deviations / scope calls

- **The rulebook's "sits out the next lot" penalty for a non-paying team
  is not system-enforced.** It's a social/procedural penalty the
  moderator announces and the room self-polices, not a hard rule the
  server checks before accepting a bid. Adding a real enforcement
  mechanism (e.g., a per-team "suspended until lot N" flag) would be a
  schema change for a penalty the rulebook itself frames informally —
  flagging the choice not to build it rather than silently skipping it.
- **No new schema for this phase.** Every incident action reuses existing
  tables (`teams.status`, `audit_log`, reversing `team_inventory_
  transactions` rows) rather than adding new ones — reopening a lot
  doesn't need a new "reopen event" table when the audit log and an
  honest reversing ledger entry already tell the whole story.
- Server-restart resilience and reconnect handling were largely already
  true by architecture (Postgres as source of truth since Phase 1); this
  phase's actual code change there was narrow (the frontend reconnect-
  refetch fix above), not a new resilience layer.

## What's still not done

- **8-10 dummy teams / a full live rehearsal** — this is a live,
  human-run exercise, not something to fake in an automated test. The
  automated test suite covers the mechanics each rehearsal scenario
  exercises (see the CONTINGENCIES table above), but an actual rehearsal
  with real people clicking through the actual screens hasn't happened
  and should, before a real event.
- **Stage 2/3 UI screens** (Trade & Build, City Auction, Portfolio/Score)
  — still the biggest visible gap. Every command they'd call is built,
  tested, and documented in the quick guide's raw-endpoint form; the
  screens themselves are the remaining work.
- **`event_staff` has no self-serve invite flow** — adding a moderator is
  a direct database insert today (documented in the quick guide's setup
  checklist). Worth a small admin screen before a real event if more than
  one or two people need moderator access.
- Team inventory and per-lot bid-history CSV exports (Section 7.9 lists
  them alongside standings/audit-log) aren't built as dedicated export
  endpoints yet — the JSON inventory read model exists, but not a
  formatted export.

## What's left for you

- Actually run a rehearsal with real people before a live event — nothing
  in this codebase substitutes for that.
- Decide if the "sits out next lot" social penalty should become a real
  enforced rule before you rely on room self-policing for it.
- The two remaining export types (team inventory, bid history) — say if
  you want those built out to match standings/audit-log's CSV format
  before Stage 2/3 UI work, or after.
