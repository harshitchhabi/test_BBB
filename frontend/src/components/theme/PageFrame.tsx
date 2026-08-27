// Ported from the legacy repo's repeated page markup (team/page.tsx,
// cart/page.tsx, rules/page.tsx, BidClient/index.tsx all wrap their
// content in this exact same two-layer wood-panel structure): a
// wood-plank background filling the viewport, with a bordered
// main-background.png panel floating in the center holding the page's
// actual content.
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
        {children}
      </div>
    </div>
  );
}
