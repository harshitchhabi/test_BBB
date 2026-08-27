"use client";

import { useRouter } from "next/navigation";

// Ported from the legacy repo's repeated page markup (team/page.tsx,
// cart/page.tsx, rules/page.tsx, BidClient/index.tsx all wrap their
// content in this exact same two-layer wood-panel structure): a
// wood-plank background filling the viewport, with a bordered
// main-background.png panel floating in the center holding the page's
// actual content.
//
// The back button (top-left, cart_page/button.png — the exact image the
// legacy cart page used for its own "back to rules" link) was added after
// a rehearsal user got stuck several screens deep with no way back except
// the browser's own back button. `router.back()` always works regardless
// of how the user arrived at the page, unlike a hard-coded href.
export function PageFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center bg-repeat py-8"
      style={{ backgroundImage: "url('/assets/images/background.png')" }}
    >
      <div
        className="relative w-[94%] max-w-6xl min-h-[80vh] p-4 md:p-6 flex flex-col items-center rounded-lg shadow-xl minecraft-font"
        style={{
          backgroundImage: "url('/assets/images/main-background.png')",
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }}
      >
        <button onClick={() => router.back()} className="self-start mb-2 opacity-90 hover:opacity-100" aria-label="Back">
          <img src="/assets/images/cart_page/button.png" alt="Back" className="h-9" />
        </button>
        {children}
      </div>
    </div>
  );
}
