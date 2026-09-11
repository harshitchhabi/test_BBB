"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Section 7.1 team portal navigation, restyled to the legacy's wood/gold
// theme instead of a plain browser nav bar. Also the one place every team
// screen shares, so it's where a staff member's only route to the
// moderator console lives.
//
// Staff (moderator/admin) accounts are kept strictly separate from
// playing: every "your team" screen — Live Auction, Inventory, Trade &
// Build, City Auction, Portfolio — is hidden for ANY staff account,
// whether or not they happen to own a team row. Event Home and Rules
// stay (both are useful regardless of role) and the Moderator Console
// link takes over as the primary destination. This was previously
// conditional on "does this staff member also have a team," but that
// let an admin who created a team for local testing end up seeing the
// full player nav — staff should only ever see auction control.
export function TeamNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${eventId}/overview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setIsStaff(Boolean(d?.isStaff));
      })
      .catch(() => {});
  }, [eventId]);

  const teamOnlyLinks = [
    { href: `/events/${eventId}/auction`, label: "Live Auction" },
    { href: `/events/${eventId}/inventory`, label: "Inventory" },
    { href: `/events/${eventId}/trade-build`, label: "Trade & Build" },
    { href: `/events/${eventId}/city-auction`, label: "City Auction" },
    { href: `/events/${eventId}/portfolio`, label: "Portfolio & Score" },
  ];
  const links = [
    { href: `/events/${eventId}`, label: "Event Home" },
    ...(isStaff ? [] : teamOnlyLinks),
    { href: `/events/${eventId}/rules`, label: "Rules" },
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
      {isStaff && (
        <Link
          href={`/events/${eventId}/moderator/setup`}
          className="px-3 py-1.5 rounded text-sm md:text-base shadow bg-yellow-600 text-black font-bold hover:bg-yellow-500"
        >
          🛠 Moderator Console
        </Link>
      )}
    </nav>
  );
}
