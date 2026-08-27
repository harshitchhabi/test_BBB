"use client";

import { use } from "react";
import { ModNav } from "../mod-nav";

// Section 7.9 Exports.
export default function ModeratorExportsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 700 }}>
      <ModNav eventId={eventId} />
      <h1>Exports</h1>
      <ul>
        <li>
          <a href={`/api/events/${eventId}/exports/standings`}>Final standings (CSV)</a>
        </li>
        <li>
          <a href={`/api/events/${eventId}/exports/audit-log`}>Audit log (CSV)</a>
        </li>
        <li>
          <a href={`/api/events/${eventId}/exports/inventory`}>Team inventory ledger (CSV)</a>
        </li>
        <li>
          <a href={`/api/events/${eventId}/exports/bid-history`}>Stage 1 bid history (CSV)</a>
        </li>
      </ul>
    </main>
  );
}
