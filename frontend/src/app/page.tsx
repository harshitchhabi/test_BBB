"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, useSessionRefresh, signOut } from "@/lib/use-session";

// Hero styling ported from the legacy repo's src/app/page.tsx (bg.png
// full-bleed background, Minecraft-font title, tan action button).
//
// This deployment is one EC2 instance per live event, so there is only
// ever one event to go to — nobody should ever have to type or paste an
// event id. Once signed in, we fetch the single event that exists on this
// server and jump straight there.
//
// Task 1: Google sign-in replaced with a username/password form — every
// login (one shared credential per team, plus staff) is admin-issued,
// never self-registered here.
//
// The "Back to Login" button on every other screen also points here, and
// it needs to actually land on this page instead of bouncing straight
// back into the event it's trying to leave. It links to "/?stay=1" for
// exactly that reason — ?stay=1 skips the auto-redirect below so a
// signed-in user can genuinely get back to this screen (to switch
// accounts, sign out, or just see it) instead of the back button
// looking broken.
export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { data: session, status } = useSession();
  const refreshSession = useSessionRefresh();
  const router = useRouter();
  const searchParams = useSearchParams();
  const stay = searchParams.get("stay") === "1";
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  // Disable-on-submit (Task 5): without this, a slow network plus an
  // impatient double-click sends two login requests — harmless against
  // the DB, but each one burns a rate-limit "attempt" and can trip the
  // lockout on a legitimate team just being fast with the Enter key.
  const loginDisabled = loggingIn || !username || !password;

  useEffect(() => {
    fetch("/api/events/default")
      .then((r) => r.json())
      .then((d) => {
        if (d.event) {
          setEventId(d.event.id);
          setEventName(d.event.name);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true));
  }, []);

  useEffect(() => {
    if (status === "authenticated" && eventId && !stay) {
      router.replace(`/events/${eventId}`);
    }
  }, [status, eventId, stay, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loginDisabled) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(body.message ?? `Sign-in failed (${res.status}). Please try again.`);
        return;
      }
      setPassword("");
      await refreshSession();
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div
      className="relative min-h-screen w-full bg-cover bg-center flex flex-col justify-center items-start px-6 md:px-16"
      style={{ backgroundImage: "url('/assets/images/bg.png')" }}
    >
      <nav className="absolute top-0 left-0 w-full p-4 flex justify-between items-center bg-black/50 text-white">
        <h1 className="text-lg md:text-xl font-bold minecraft-font">
          BRICKS BY BID <span className="text-[#C4FC84]">2025</span>
        </h1>
        {status === "authenticated" && (
          <div className="flex items-center gap-4">
            <p className="text-sm">Hi, {session?.user?.name}</p>
            <button onClick={() => signOut({ callbackUrl: "/" })} className="hover:text-red-400">
              Sign Out
            </button>
          </div>
        )}
      </nav>

      <p className="text-xs md:text-sm font-semibold text-white">Dream Merchants VIT Presents</p>
      <h2 className="text-4xl md:text-6xl font-extrabold mt-2 minecraft-font text-black">
        BRICKS <span className="text-yellow-500">BY BID</span>
      </h2>
      <p className="mt-4 text-sm md:text-lg font-bold text-white">Trade Smart, Bid Bold, Build Big</p>
      {eventName && <p className="mt-1 text-sm text-white/80">{eventName}</p>}

      <div className="mt-6">
        {status === "loading" && <p className="text-white">Loading…</p>}

        {status === "unauthenticated" && !notFound && (
          <form onSubmit={handleLogin} className="flex flex-col gap-3 bg-black/40 p-4 rounded w-72">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              className="px-3 py-2 rounded text-black"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              className="px-3 py-2 rounded text-black"
            />
            <button
              type="submit"
              disabled={loginDisabled}
              className="bg-[#B17E41] px-6 py-2 text-black text-lg font-bold minecraft-font shadow-lg disabled:opacity-50"
            >
              {loggingIn ? "Signing in…" : "Sign In →"}
            </button>
            {loginError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-sm">{loginError}</p>}
            <p className="text-white/70 text-xs">Your moderator issues your team's username and password.</p>
          </form>
        )}

        {status === "authenticated" && eventId && stay && (
          <button
            onClick={() => router.push(`/events/${eventId}`)}
            className="bg-[#B17E41] px-6 py-3 text-black text-lg font-bold minecraft-font shadow-lg"
          >
            Continue to event →
          </button>
        )}
        {status === "authenticated" && !eventId && !notFound && <p className="text-white">Loading event…</p>}
        {notFound && (
          <p className="bg-black/50 text-red-100 font-medium px-4 py-3 rounded max-w-md">
            No event has been set up on this server yet. Ask your moderator to create one.
          </p>
        )}
      </div>
    </div>
  );
}
