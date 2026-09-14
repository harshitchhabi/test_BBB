"use client";

import { useEffect, useState } from "react";

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
  promise: Promise<unknown> | null;
}

const cache = new Map<string, CacheEntry>();

function fetchOverview(eventId: string): Promise<unknown> {
  const entry = cache.get(eventId);
  if (entry) {
    const fresh = Date.now() - entry.fetchedAt < CACHE_TTL_MS;
    if (fresh && !entry.promise) return Promise.resolve(entry.data);
    if (entry.promise) return entry.promise;
  }

  const promise = fetch(`/api/events/${eventId}/overview`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      cache.set(eventId, { data, fetchedAt: Date.now(), promise: null });
      return data;
    })
    .catch(() => {
      cache.delete(eventId);
      return null;
    });

  cache.set(eventId, { data: entry?.data ?? null, fetchedAt: entry?.fetchedAt ?? 0, promise });
  return promise;
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
    fetchOverview(eventId).then((data) => {
      if (!cancelled) setOverview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return overview;
}
