"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Section 7.1 team portal navigation: Event Home, Live Auction, Inventory,
// Trade & Build, City Auction, Portfolio & Score, Rules.
export function TeamNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const links = [
    { href: `/events/${eventId}`, label: "Event Home" },
    { href: `/events/${eventId}/auction`, label: "Live Auction" },
    { href: `/events/${eventId}/inventory`, label: "Inventory" },
    { href: `/events/${eventId}/trade-build`, label: "Trade & Build" },
    { href: `/events/${eventId}/city-auction`, label: "City Auction" },
    { href: `/events/${eventId}/portfolio`, label: "Portfolio & Score" },
    { href: `/events/${eventId}/rules`, label: "Rules" },
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
