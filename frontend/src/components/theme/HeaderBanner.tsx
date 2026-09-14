// Every legacy page with a title (BidClient, cart/page.tsx) renders it
// inside a wooden banner image with cream text and a brown outline
// stroke, never a plain <h1>. bid/header.png is the generic plank banner
// reused across every screen that doesn't have its own dedicated banner
// asset (cart_page/header.png, team/header-bg.png, rules/heading.png are
// used directly on the few screens the legacy actually built).
export function HeaderBanner({
  children,
  image = "/assets/images/bid/header.png",
}: {
  children: React.ReactNode;
  image?: string;
}) {
  return (
    <div
      className="w-[95%] md:w-[90%] p-6 md:p-8 mb-6 flex justify-center items-center rounded-lg"
      style={{ backgroundImage: `url('${image}')`, backgroundSize: "cover", backgroundRepeat: "no-repeat" }}
    >
      <h1 className="minecraft-font text-2xl md:text-3xl text-[#F1EBB5] font-bold tracking-widest text-outline-brown text-center">
        {children}
      </h1>
    </div>
  );
}
