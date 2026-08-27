"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Section 7.8 moderator console navigation, same wood/gold theme as the
// team portal's nav. Score & Reveal lives inside the Cities screen
// (revealCitiesAndScore is one atomic action, not a separate step — see
// docs/phase-4.md) rather than getting its own link.
export function ModNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const links = [
    { href: `/events/${eventId}/moderator/setup`, label: "Event Setup" },
    { href: `/events/${eventId}/moderator/auction`, label: "Stage 1 Auction" },
    { href: `/events/${eventId}/moderator/trades`, label: "Trade Desk" },
    { href: `/events/${eventId}/moderator/buildings`, label: "Build / Deed Desk" },
    { href: `/events/${eventId}/moderator/cities`, label: "Stage 3 Cities & Reveal" },
    { href: `/events/${eventId}/moderator/teams`, label: "Teams & Incidents" },
    { href: `/events/${eventId}/moderator/exports`, label: "Exports" },
  ];
  return (
    <nav className="w-full flex flex-wrap justify-center gap-2 mb-4 minecraft-font">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`px-3 py-1.5 rounded text-sm md:text-base shadow ${
            pathname === l.href ? "bg-[#F1EBB5] text-[#4e3016] font-bold" : "bg-[#463d36] text-[#F1EBB5] hover:bg-[#62574e]"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
