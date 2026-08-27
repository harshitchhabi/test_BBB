"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";

// Hero styling ported from the legacy repo's src/app/page.tsx (bg.png
// full-bleed background, Minecraft-font title, tan action button) — only
// the action itself changes, since there's no fixed "/team" or "/bid"
// route anymore: sign in, then jump straight to whichever event id your
// moderator shared with you.
export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [eventId, setEventId] = useState("");

  return (
    <div
      className="relative min-h-screen w-full bg-cover bg-center flex flex-col justify-center items-start px-6 md:px-16"
      style={{ backgroundImage: "url('/assets/images/bg.png')" }}
    >
      <nav className="absolute top-0 left-0 w-full p-4 flex justify-between items-center bg-black/50 text-white">
        <h1 className="text-lg md:text-xl font-bold minecraft-font">
          BRICKS BY BID <span className="text-[#C4FC84]">2025</span>
        </h1>
        {status === "authenticated" ? (
          <div className="flex items-center gap-4">
            <p className="text-sm">Hi, {session.user?.name}</p>
            <button onClick={() => signOut({ callbackUrl: "/" })} className="hover:text-red-400">
              Sign Out
            </button>
          </div>
        ) : (
          <button onClick={() => signIn("google")} className="hover:text-green-400">
            Login
          </button>
        )}
      </nav>

      <p className="text-xs md:text-sm font-semibold text-white">Dream Merchants VIT Presents</p>
      <h2 className="text-4xl md:text-6xl font-extrabold mt-2 minecraft-font text-black">
        BRICKS <span className="text-yellow-500">BY BID</span>
      </h2>
      <p className="mt-4 text-sm md:text-lg font-bold text-white">Trade Smart, Bid Bold, Build Big</p>

      <div className="mt-6">
        {status === "loading" && <p className="text-white">Loading…</p>}
        {status === "unauthenticated" && (
          <button onClick={() => signIn("google")} className="bg-[#B17E41] px-6 py-3 text-black text-lg font-bold minecraft-font shadow-lg">
            Register Now →
          </button>
        )}
        {status === "authenticated" && (
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center bg-black/40 p-4 rounded">
            <input
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder="event id from your moderator"
              className="px-4 py-2 rounded text-black w-72"
            />
            <button
              onClick={() => router.push(`/events/${eventId}`)}
              disabled={!eventId}
              className="bg-[#B17E41] px-6 py-2 text-black text-lg font-bold minecraft-font shadow-lg disabled:opacity-50"
            >
              Go →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
