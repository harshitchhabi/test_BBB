"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Task 1: drop-in replacement for next-auth/react's SessionProvider /
// useSession / signOut, same {data, status} shape, so the 16 screens
// that already called useSession() only need their import swapped, not
// their logic rewritten. signIn("google") had exactly one real call
// site (the home page's login form), replaced there with a real
// username+password call to /api/auth/login.
export type SessionUser = { id: string; name: string; username: string };
export type SessionData = { user: SessionUser } | null;
type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  data: SessionData;
  status: SessionStatus;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  data: null,
  status: "loading",
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SessionData>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const body = await res.json();
      setData(body);
      setStatus(body ? "authenticated" : "unauthenticated");
    } catch {
      setData(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ data, status, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  return { data: ctx.data, status: ctx.status };
}

// Not exposed by next-auth's useSession() either — the login form calls
// the API route itself, then this to make every useSession() consumer
// re-render with the new state instead of waiting for a full page
// reload.
export function useSessionRefresh() {
  return useContext(SessionContext).refresh;
}

export async function signOut(options?: { callbackUrl?: string }) {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = options?.callbackUrl ?? "/";
}
