"use client";

import { SessionProvider } from "@/lib/use-session";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
