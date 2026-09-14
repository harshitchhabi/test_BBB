"use client";

// Ported from the legacy repo's repeated page markup (team/page.tsx,
// cart/page.tsx, rules/page.tsx, BidClient/index.tsx all wrap their
// content in this exact same two-layer wood-panel structure): a
// wood-plank background filling the viewport, with a bordered
// main-background.png panel floating in the center holding the page's
// actual content.
//
// The back button (top-left) was added after a rehearsal user got stuck
// several screens deep with no way back. It deliberately always goes to
// "/" (the sign-in/home page), not router.back() — browser history back
// was confusing since it could land on a half-loaded intermediate state
// or a different event entirely; going home is the one destination that
// always makes sense from any screen in the app. This is a plain text
// button, not the legacy's cart_page/button.png — that image has "BACK
// TO RULES" baked into its pixels (it was the cart page's own link back
// to the rules screen originally), which was actively misleading once
// reused here for a different destination and a caption no CSS/props can
// change.
//
// It links to "/?stay=1", not bare "/": the home page auto-redirects a
// signed-in visitor straight back into the one event on this server (so
// nobody has to paste an event id), which otherwise turns this button
// into an infinite bounce — click it and you're immediately shoved right
// back where you started. ?stay=1 tells the home page to actually show
// itself instead.
export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center bg-repeat py-8"
      style={{ backgroundImage: "url('/assets/images/background.png')" }}
    >
      <div
        className="relative w-[94%] max-w-6xl min-h-[80vh] p-4 md:p-6 flex flex-col items-center rounded-lg shadow-xl"
        style={{
          backgroundImage: "url('/assets/images/main-background.png')",
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }}
      >
        <a
          href="/?stay=1"
          className="self-start mb-2 px-3 py-1.5 rounded text-sm bg-[#463d36] text-[#F1EBB5] hover:bg-[#62574e] shadow"
        >
          ← Back to Login
        </a>
        {children}
      </div>
    </div>
  );
}
