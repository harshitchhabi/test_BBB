"use client";

import { use, useState } from "react";
import { ModNav } from "../mod-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.8 "Event Setup" nav item. Materials/recipes/shocks/cities are
// seeded from packages/db/seed (Phase 0) rather than authored through a
// UI — this screen's job for now is the one setup step that genuinely
// needs a person: adding moderators. Anyone can add the very first one
// for a brand-new event; after that only existing staff can add more.
export default function ModeratorSetupPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"moderator" | "admin">("moderator");
  const [message, setMessage] = useState<string | null>(null);

  async function addStaff() {
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetEmail: email, role }),
    });
    const body = await res.json();
    setMessage(res.ok ? `Added ${email} as ${role}.` : body.message);
    if (res.ok) setEmail("");
  }

  return (
    <PageFrame>
      <ModNav eventId={eventId} />
      <HeaderBanner>EVENT SETUP</HeaderBanner>

      <Panel className="w-full max-w-lg">
        <PanelTitle>ADD A MODERATOR</PanelTitle>
        <p className="text-white/70 text-sm mb-3">
          The person must have signed in at least once. If nobody is staff for this event yet, anyone can add the
          first one; after that, only existing staff can add more.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their-email@example.com" className="flex-1 min-w-48 px-3 py-2 rounded text-black" />
          <select value={role} onChange={(e) => setRole(e.target.value as "moderator" | "admin")} className="px-2 py-2 rounded text-black">
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
          <WoodButton variant="primary" onClick={addStaff} disabled={!email}>Add</WoodButton>
        </div>
        {message && <p className="text-yellow-300 mt-3">{message}</p>}
      </Panel>

      <p className="mt-6 text-white/70 max-w-lg text-center">
        Materials, recipes, Market Shock cards, and city blocks are configured via <code>packages/db/seed/data.ts</code>
        and applied with <code>npx tsx seed/run.ts</code> before the event starts.
      </p>
    </PageFrame>
  );
}
