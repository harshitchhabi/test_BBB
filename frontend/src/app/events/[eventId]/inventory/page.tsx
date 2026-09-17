"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/use-session";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { fetchEventOverviewFresh } from "@/lib/use-event-overview";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle, WoodButton } from "@/components/theme/Panel";

// Section 7.4 Inventory screen, styled with the legacy cart page's exact
// banner/panel treatment (cart/page.tsx's "Won Auctions Panel" pattern).
export default function InventoryPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [inventory, setInventory] = useState<any[] | null>(null);
  const [bankStock, setBankStock] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buyMaterialTypeId, setBuyMaterialTypeId] = useState("");
  const [buyQuantity, setBuyQuantity] = useState("");
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyMessage, setBuyMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const ov = (await fetchEventOverviewFresh(eventId)) as any;
      setOverview(ov);
      if (ov.myTeam) {
        const inv = await fetchJson<any>(`/api/events/${eventId}/teams/${ov.myTeam.id}/inventory`);
        setInventory(inv.inventory);
      }
      const bank = await fetchJson<any>(`/api/events/${eventId}/bank-stock`);
      setBankStock(bank.stock);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof FetchJsonError ? err.message : "Couldn't load this page. Retrying…");
    }
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  // A ref, not the buyBusy state: React's re-render (which is what
  // actually disables the Buy button on screen) happens asynchronously
  // relative to the click event, so two clicks close enough together
  // (a fast double-click, or Enter held on a focused button) can both
  // reach this function while buyBusy still reads its old value in
  // both closures - a real risk here specifically, since a double-fire
  // would charge tokens and consume finite bank stock twice. A ref is
  // read fresh on every call regardless of render timing.
  const buyGuardRef = useRef(false);
  async function buyFromBank() {
    if (!overview?.myTeam || buyGuardRef.current || !buyMaterialTypeId || !buyQuantity) return;
    buyGuardRef.current = true;
    setBuyBusy(true);
    setBuyMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/bank-purchases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: overview.myTeam.id, materialTypeId: buyMaterialTypeId, quantity: Number(buyQuantity) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBuyMessage({ text: body.message ?? `Something went wrong (${res.status}). Please try again.`, ok: false });
      } else {
        setBuyMessage({ text: `Bought ${body.quantity} for ${body.totalCost} tokens (${body.basePrice} + ${body.taxAmount} tax).`, ok: true });
        setBuyQuantity("");
      }
      await refresh();
    } finally {
      buyGuardRef.current = false;
      setBuyBusy(false);
    }
  }

  if (loadError && !overview) return <PageFrame><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  const buyMaterial = bankStock?.find((s) => s.materialTypeId === buyMaterialTypeId);
  const buyTaxPercent = buyMaterial ? (buyMaterial.isRare ? overview.settings.rareBankTaxPercent : overview.settings.normalBankTaxPercent) : 0;
  const buyQuantityNum = Number(buyQuantity);
  const buyPreview =
    buyMaterial && Number.isInteger(buyQuantityNum) && buyQuantityNum > 0
      ? (() => {
          const basePrice = buyMaterial.stickerPrice * buyQuantityNum;
          const taxAmount = Math.ceil((basePrice * buyTaxPercent) / 100);
          return { basePrice, taxAmount, totalCost: basePrice + taxAmount };
        })()
      : null;

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner image="/assets/images/cart_page/header.png">MY INVENTORY</HeaderBanner>
      {loadError && <p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium mb-3">{loadError}</p>}

      {!overview.myTeam ? (
        <p className="text-[#F1EBB5]">Join a team first.</p>
      ) : (
        <Panel className="w-full max-w-3xl mb-6">
          <PanelTitle>
            <img src="/assets/images/cart_page/cart-icon.png" className="w-6 h-6" alt="" />
            {overview.myTeam.name}'S MATERIALS
          </PanelTitle>
          <div className="space-y-2">
            {inventory?.filter((i) => i.quantity !== 0).map((i) => (
              <div key={i.materialTypeId} className="bg-[#764A21]/52 p-3 rounded-lg shadow-inner flex justify-between items-center">
                <span className="text-yellow-300">{i.materialName}</span>
                <span className="text-white text-lg font-bold">{i.quantity}</span>
              </div>
            ))}
            {inventory?.every((i) => i.quantity === 0) && <p className="text-[#F1EBB5] text-center py-4">No materials yet.</p>}
          </div>
        </Panel>
      )}

      <Panel className="w-full max-w-3xl">
        <PanelTitle>BANK STOCK (STAGE 2)</PanelTitle>
        <div className="space-y-2">
          {bankStock?.map((s) => (
            <div key={s.materialTypeId} className="bg-[#764A21]/52 p-3 rounded-lg shadow-inner flex justify-between items-center">
              <span className="text-yellow-300">{s.materialName}</span>
              <span className="text-white">{s.availableQuantity} available</span>
              <span className="text-white/70 text-sm">{s.isRare ? overview.settings.rareBankTaxPercent : overview.settings.normalBankTaxPercent}% tax</span>
            </div>
          ))}
        </div>

        {overview.myTeam && overview.event.status === "stage_2" && (
          <div className="mt-4 pt-4 border-t border-white/10">
            {overview.myRole === "leader" ? (
              <>
                <div className="flex gap-2 flex-wrap items-center">
                  <select
                    value={buyMaterialTypeId}
                    onChange={(e) => setBuyMaterialTypeId(e.target.value)}
                    className="flex-1 min-w-40 px-3 py-2 rounded text-black"
                  >
                    <option value="">Buy which material…</option>
                    {bankStock
                      ?.filter((s) => s.availableQuantity > 0)
                      .map((s) => (
                        <option key={s.materialTypeId} value={s.materialTypeId}>{s.materialName} ({s.availableQuantity} left)</option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={buyMaterial?.availableQuantity}
                    value={buyQuantity}
                    onChange={(e) => setBuyQuantity(e.target.value)}
                    placeholder="qty"
                    className="w-24 px-3 py-2 rounded text-black"
                  />
                  <WoodButton variant="primary" disabled={buyBusy || !buyMaterialTypeId || !buyQuantity} onClick={buyFromBank}>
                    {buyBusy ? "Buying…" : "Buy"}
                  </WoodButton>
                </div>
                {buyPreview && (
                  <p className="text-white/70 text-sm mt-2">
                    {buyPreview.basePrice} + {buyPreview.taxAmount} tax = <strong className="text-yellow-300">{buyPreview.totalCost} tokens</strong>
                  </p>
                )}
                {buyMessage && (
                  <p className={`px-3 py-2 rounded-md font-medium mt-2 ${buyMessage.ok ? "text-green-100 bg-green-950/80" : "text-red-100 bg-red-950/80"}`}>
                    {buyMessage.text}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[#F1EBB5] text-sm">Only your team leader can buy from the bank.</p>
            )}
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}
