"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEventOverview } from "@/lib/use-event-overview";
import { useEventSocket } from "@/lib/use-event-socket";

// A plain wall clock, not a lot/auction countdown (those already exist
// on the Stage 1 and Cities consoles) - a moderator running a live event
// needs the current time visible on every screen to pace rounds against
// a schedule, not just how long the CURRENT lot has left.
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // Renders nothing until the first client-side tick - avoids a
  // server/client markup mismatch, since the server has no "current
  // time" to render that would ever match the client's.
  if (!now) return null;
  return (
    <span className="px-3 py-1.5 rounded bg-[#463d36] text-[#F1EBB5] text-sm md:text-base font-mono tracking-wide shadow">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

// The countdown for whatever lot/city-auction is actually live right
// now — not the wall clock above. Previously this only existed on the
// Stage 1 Auction Control and Cities screens themselves, so a moderator
// on any OTHER tab (Teams, Trade Desk, ...) while a timer was running
// had no idea it was about to expire without switching tabs to check.
// Lives in the nav bar itself so it's visible from anywhere in the
// console. Renders nothing when nothing is actually live, on purpose —
// this is "the auction timer when the auction is happening," not a
// permanent fixture.
function LiveAuctionCountdown({ eventId, eventStatus }: { eventId: string; eventStatus: string | null }) {
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [label, setLabel] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (eventStatus === "stage_1") {
      const res = await fetch(`/api/events/${eventId}/auction-state`);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.liveLot?.closesAt) {
        setClosesAt(body.liveLot.closesAt);
        setLabel(`Lot #${body.liveLot.lotNumber}`);
        return;
      }
    } else if (eventStatus === "stage_3") {
      const res = await fetch(`/api/events/${eventId}/city-auctions/list`);
      const body = await res.json().catch(() => null);
      const live = body?.auctions?.find((a: any) => a.status === "live" && a.closesAt);
      if (res.ok && live) {
        setClosesAt(live.closesAt);
        setLabel(live.city?.name ?? "City auction");
        return;
      }
    }
    setClosesAt(null);
  }, [eventId, eventStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  const { connected } = useEventSocket(eventId, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  useEffect(() => {
    if (!closesAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [closesAt]);

  if (!closesAt) return null;
  const secondsLeft = Math.max(0, Math.round((new Date(closesAt).getTime() - now) / 1000));
  const urgent = secondsLeft <= 10;
  return (
    <span
      className={`px-3 py-1.5 rounded font-mono text-sm md:text-base font-bold shadow ${urgent ? "bg-red-800 text-white animate-pulse" : "bg-[#463d36] text-yellow-300"}`}
    >
      {label}: {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
    </span>
  );
}

// Section 7.8 moderator console navigation, same wood/gold theme as the
// team portal's nav. Score & Reveal lives inside the Cities screen
// (revealCitiesAndScore is one atomic action, not a separate step — see
// docs/phase-4.md) rather than getting its own link.
//
// Task 7: this used to show all seven tabs at equal weight regardless of
// what stage the event is actually in, so a moderator mid-event was
// hunting past Stage 3 controls to find the Stage 1 tab. Setup, Teams,
// and Exports are useful at any stage and always stay full-weight. The
// three stage-specific desks (Auction, Trade/Build, Cities) are
// foregrounded only for their own stage — but never fully hidden, just
// shown smaller/muted otherwise, since a moderator legitimately might
// need to go back and void a Stage 2 building, or check Stage 1 history,
// after the event has moved on.
const STAGE_RELEVANCE: Record<string, string[]> = {
  setup: [],
  lobby: [],
  stage_1: ["/moderator/auction"],
  stage_2: ["/moderator/trades", "/moderator/buildings"],
  stage_3: ["/moderator/cities"],
  scoring: ["/moderator/cities"],
  completed: ["/moderator/cities"],
  paused: [],
};

export function ModNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const overview = useEventOverview(eventId);
  const eventStatus: string | null = overview?.event?.status ?? null;

  const alwaysOn = [{ href: `/events/${eventId}/moderator/setup`, label: "Event Setup" }];
  const stageLinks = [
    { href: `/events/${eventId}/moderator/auction`, label: "Stage 1 Auction", key: "/moderator/auction" },
    { href: `/events/${eventId}/moderator/trades`, label: "Trade Desk", key: "/moderator/trades" },
    { href: `/events/${eventId}/moderator/buildings`, label: "Build / Deed Desk", key: "/moderator/buildings" },
    { href: `/events/${eventId}/moderator/cities`, label: "Stage 3 Cities & Reveal", key: "/moderator/cities" },
  ];
  const alwaysOnEnd = [
    { href: `/events/${eventId}/moderator/teams`, label: "Teams & Incidents" },
    { href: `/events/${eventId}/moderator/exports`, label: "Exports" },
  ];

  const relevantKeys = eventStatus ? (STAGE_RELEVANCE[eventStatus] ?? []) : null;
  // Before the status is known yet (still loading), show everything at
  // full weight rather than guessing wrong and flashing tabs smaller —
  // once it arrives, the current stage's tab(s) foreground properly.
  const isRelevant = (key: string) => relevantKeys === null || relevantKeys.length === 0 || relevantKeys.includes(key);

  function renderLink(href: string, label: string, muted: boolean) {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`rounded shadow transition-all ${muted ? "px-2 py-1 text-xs md:text-sm opacity-60 hover:opacity-100" : "px-3 py-1.5 text-sm md:text-base"} ${
          active ? "bg-[#F1EBB5] text-[#4e3016] font-bold" : "bg-[#463d36] text-[#F1EBB5] hover:bg-[#62574e]"
        }`}
      >
        {label}
      </Link>
    );
  }

  return (
    <nav className="w-full flex flex-wrap justify-center items-center gap-2 mb-4 minecraft-font">
      {alwaysOn.map((l) => renderLink(l.href, l.label, false))}
      {stageLinks.map((l) => renderLink(l.href, l.label, !isRelevant(l.key)))}
      {alwaysOnEnd.map((l) => renderLink(l.href, l.label, false))}
      <span className="ml-auto flex items-center gap-2">
        <LiveAuctionCountdown eventId={eventId} eventStatus={eventStatus} />
        <LiveClock />
      </span>
    </nav>
  );
}
