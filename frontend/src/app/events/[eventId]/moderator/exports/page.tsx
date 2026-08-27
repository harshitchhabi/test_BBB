"use client";

import { use } from "react";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel } from "@/components/theme/Panel";

// Section 7.9 Exports.
export default function ModeratorExportsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>EXPORTS</HeaderBanner>
      <Panel className="w-full max-w-lg">
        <ul className="space-y-2 text-yellow-200 underline">
          <li><a href={`/api/events/${eventId}/exports/standings`}>Final standings (CSV)</a></li>
          <li><a href={`/api/events/${eventId}/exports/audit-log`}>Audit log (CSV)</a></li>
          <li><a href={`/api/events/${eventId}/exports/inventory`}>Team inventory ledger (CSV)</a></li>
          <li><a href={`/api/events/${eventId}/exports/bid-history`}>Stage 1 bid history (CSV)</a></li>
        </ul>
      </Panel>
    </PageFrame>
  );
}
