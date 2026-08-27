// The semi-transparent tan content panel every legacy screen's sections
// sit inside (cart/page.tsx's "Token Balance Panel" / "Won Auctions
// Panel", BidClient's auction/bidding cards): bg-[#978056]/37, rounded-xl,
// shadow-lg.
export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`w-full bg-[#978056]/37 rounded-xl shadow-lg p-4 md:p-6 ${className}`}>{children}</div>;
}

export function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[#A43737] font-bold text-xl md:text-2xl mb-4 tracking-wide drop-shadow-[0_0_1px_#FFD700]">
      {children}
    </div>
  );
}

// The dark-brown stat tile (cart/page.tsx's token balance numbers):
// bg-[#764A21]/52, shadow-inner, white text.
export function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[#764A21]/52 p-4 rounded-lg shadow-inner text-white text-center tracking-wide">
      <span className="text-sm md:text-base block">{label}</span>
      <span className="text-2xl md:text-3xl font-bold">{value}</span>
    </div>
  );
}

export function WoodButton({
  children,
  variant = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "danger" | "primary" }) {
  const variants = {
    default: "bg-[#463d36] hover:bg-[#62574e]",
    primary: "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800",
    danger: "bg-red-700 hover:bg-red-800",
  };
  return (
    <button
      {...props}
      className={`px-4 py-2 text-white rounded shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
