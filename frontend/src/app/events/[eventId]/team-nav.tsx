"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Section 7.1 team portal navigation, restyled to the legacy's wood/gold
// theme instead of a plain browser nav bar.
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
