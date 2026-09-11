"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";
import { HeaderBanner } from "@/components/theme/HeaderBanner";
import { Panel, PanelTitle } from "@/components/theme/Panel";

// Section 7.4 Inventory screen, styled with the legacy cart page's exact
// banner/panel treatment (cart/page.tsx's "Won Auctions Panel" pattern).
export default function InventoryPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [inventory, setInventory] = useState<any[] | null>(null);
  const [bankStock, setBankStock] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const ov = await fetchJson<any>(`/api/events/${eventId}/overview`);
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

  if (loadError && !overview) return <PageFrame><p className="text-red-300 text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <HeaderBanner image="/assets/images/cart_page/header.png">MY INVENTORY</HeaderBanner>
      {loadError && <p className="text-red-300 mb-3">{loadError}</p>}

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
      </Panel>
    </PageFrame>
  );
}
