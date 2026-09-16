"use client";

import { useEffect, useState } from "react";
import { FetchJsonError } from "./fetch-json";

// Task 6 fixed the WebSocket-per-navigation lag; its own commit note
// flagged this smaller sibling and deliberately left it unfixed at the
// time: TeamNav and ModNav each independently GET /overview on every
// mount, purely to learn isStaff / event.status - and since they render
// inside every single page rather than a shared layout, EVERY page
// navigation pays for that request a second time (once for the nav,
// once for whatever the page itself needs from /overview). Still felt
// laggy after Task 6 specifically because of this - a real network
// round trip on every click, not just once per session like the socket
// was.
//
// A short-TTL, in-memory, cross-component cache: any two things that
// mount within CACHE_TTL_MS of each other (a nav bar and its page, or
// two nav bars during a fast double-click) share ONE fetch instead of
// each firing their own. Deliberately NOT a long cache - overview
// includes live things (event status, isStaff) a moderator action can
// change out from under a user within the same session, so freshness
// still matters; this only dedupes requests that are effectively
// simultaneous from a user's perspective.
const CACHE_TTL_MS = 2000;

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
  // Always the RAW fetch promise (throws FetchJsonError on failure,
  // resolves with the parsed body on success) - never an
  // already-error-handled wrapper. Two different consumers (the
  // swallow-to-null hook below, and the throwing fetchEventOverviewFresh)
  // each apply their OWN .then/.catch on top of this same shared
  // promise, so joining an in-flight request never silently changes
  // which error contract a caller gets.
  promise: Promise<unknown> | null;
}

const cache = new Map<string, CacheEntry>();

async function fetchOverviewRaw(eventId: string): Promise<unknown> {
  const res = await fetch(`/api/events/${eventId}/overview`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new FetchJsonError(body?.message ?? `Request failed (${res.status}).`, res.status);
  return body;
}

// Returns the shared in-flight/cached raw promise for this eventId,
// starting a new network request only when neither applies.
// useFreshnessWindow controls whether an already-resolved, still-fresh
// cache entry can be returned WITHOUT a new request - true for the
// passive nav-bar poll (useEventOverview), false for a page's own
// refresh() (fetchEventOverviewFresh), which always wants current data
// and only ever piggybacks on a request that's genuinely still in flight.
function getOverviewPromise(eventId: string, useFreshnessWindow: boolean): Promise<unknown> {
  const entry = cache.get(eventId);
  if (entry?.promise) return entry.promise;
  if (useFreshnessWindow && entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(entry.data);
  }

  const promise = fetchOverviewRaw(eventId).then((data) => {
    cache.set(eventId, { data, fetchedAt: Date.now(), promise: null });
    return data;
  });
  // Errors clear the in-flight slot too (via the shared promise's own
  // rejection reaching here through the same microtask), so the next
  // caller retries instead of being stuck joining a dead promise.
  promise.catch(() => cache.delete(eventId));

  cache.set(eventId, { data: entry?.data ?? null, fetchedAt: entry?.fetchedAt ?? 0, promise });
  return promise;
}

// For every page's own refresh() (not just TeamNav/ModNav): the pages
// themselves still independently GET /overview too, so a page and its
// nav bar fetch it twice on every single navigation - the actual
// remaining "lag switching pages" after Task 6's WebSocket fix above.
// This joins an ALREADY-IN-FLIGHT request the same way the hook's cache
// does, but never serves the freshness-window cache hit - a page's own
// refresh() (on mount, on a WS broadcast, or right after its own
// mutation) needs the current truth, not up-to-2-second-old data from a
// passive nav-bar poll; only two calls landing in the same tick should
// ever share one network round trip. Throws FetchJsonError on failure,
// same contract as fetch-json.ts's fetchJson, so every page's existing
// `catch (err) { err instanceof FetchJsonError ? ... }` error handling
// keeps working unchanged when swapped in for a raw fetchJson call.
export function fetchEventOverviewFresh(eventId: string): Promise<unknown> {
  return getOverviewPromise(eventId, false);
}

// Returns the same shape /overview's route already returns
// ({event, settings, isStaff, myRole, myTeam, teams, ...}) - callers
// that only need one or two fields (isStaff, event.status) just read
// those off the result, same as before.
export function useEventOverview(eventId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [overview, setOverview] = useState<any>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    getOverviewPromise(eventId, true)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        // No error UI of its own to show - matches this hook's
        // pre-existing swallow-to-null behavior.
        if (!cancelled) setOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return overview;
}
