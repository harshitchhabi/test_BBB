"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

// There's no "list my events" concept yet (an event portal instance
// typically runs one live event at a time) — this is the simplest honest
// entry point until that's needed: sign in, then go straight to the event
// by id. A moderator shares the event id (or its full lobby URL) with
// participants the same way they'd share a join code.
export default function Home() {
  const { status } = useSession();
  const router = useRouter();
  const [eventId, setEventId] = useState("");

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 500 }}>
      <h1>Bricks by Bid</h1>
      {status === "unauthenticated" && <button onClick={() => signIn("google")}>Sign in with Google</button>}
      {status === "authenticated" && (
        <div>
          <p>Enter the event ID your moderator shared with you:</p>
          <input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="event id" style={{ width: 320 }} />
          <button onClick={() => router.push(`/events/${eventId}`)} disabled={!eventId}>
            Go
          </button>
        </div>
      )}
    </main>
  );
}
