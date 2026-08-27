"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Section 7.8 moderator console navigation. Score & Reveal lives inside
// the Cities screen (revealCitiesAndScore is one atomic action, not a
// separate step — see docs/phase-4.md) rather than getting its own link.
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
    <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem", borderBottom: "1px solid #ccc", paddingBottom: "0.75rem" }}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} style={{ fontWeight: pathname === l.href ? 700 : 400, textDecoration: pathname === l.href ? "underline" : "none" }}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
