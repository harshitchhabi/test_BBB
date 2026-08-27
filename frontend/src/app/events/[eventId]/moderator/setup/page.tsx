"use client";

import { use, useState } from "react";
import { ModNav } from "../mod-nav";

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
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 700 }}>
      <ModNav eventId={eventId} />
      <h1>Event Setup</h1>

      <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem" }}>
        <h2>Add a moderator</h2>
        <p style={{ color: "#666" }}>
          The person must have signed in at least once. If nobody is staff for this event yet, anyone can add the
          first one; after that, only existing staff can add more.
        </p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their-email@example.com" style={{ width: 280 }} />
        <select value={role} onChange={(e) => setRole(e.target.value as "moderator" | "admin")}>
          <option value="moderator">moderator</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={addStaff} disabled={!email}>Add</button>
        {message && <p>{message}</p>}
      </section>

      <p style={{ marginTop: "1.5rem", color: "#666" }}>
        Materials, recipes, Market Shock cards, and city blocks are configured via <code>packages/db/seed/data.ts</code>
        and applied with <code>npx tsx seed/run.ts</code> before the event starts — see docs/phase-0.md.
      </p>
    </main>
  );
}
