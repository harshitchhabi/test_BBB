"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEventOverview } from "@/lib/use-event-overview";

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
    </nav>
  );
}
