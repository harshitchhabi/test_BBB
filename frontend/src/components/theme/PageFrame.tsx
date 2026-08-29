"use client";

// Ported from the legacy repo's repeated page markup (team/page.tsx,
// cart/page.tsx, rules/page.tsx, BidClient/index.tsx all wrap their
// content in this exact same two-layer wood-panel structure): a
// wood-plank background filling the viewport, with a bordered
// main-background.png panel floating in the center holding the page's
// actual content.
//
// The back button (top-left, cart_page/button.png — the exact image the
// legacy cart page used for its own "back to rules" link) was added after
// a rehearsal user got stuck several screens deep with no way back. It
// deliberately always goes to "/" (the sign-in/home page), not
// router.back() — browser history back was confusing since it could land
// on a half-loaded intermediate state or a different event entirely;
// going home is the one destination that always makes sense from any
// screen in the app.
export function PageFrame({ children }: { children: React.ReactNode }) {
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
        <a href="/" className="self-start mb-2 opacity-90 hover:opacity-100" aria-label="Back to home">
          <img src="/assets/images/cart_page/button.png" alt="Back to home" className="h-9" />
        </a>
        {children}
      </div>
    </div>
  );
}
