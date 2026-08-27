"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEventSocket } from "@/lib/use-event-socket";
import { TeamNav } from "../team-nav";

// Section 7.4 Inventory screen: material quantities, source history,
// available bank stock + tax rates during Stage 2.
export default function InventoryPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [inventory, setInventory] = useState<any[] | null>(null);
  const [bankStock, setBankStock] = useState<any[] | null>(null);

  const refresh = useCallback(async () => {
    const ov = await fetch(`/api/events/${eventId}/overview`).then((r) => r.json());
    setOverview(ov);
    if (ov.myTeam) {
      const inv = await fetch(`/api/events/${eventId}/teams/${ov.myTeam.id}/inventory`).then((r) => r.json());
      setInventory(inv.inventory);
    }
    const bank = await fetch(`/api/events/${eventId}/bank-stock`).then((r) => r.json());
    setBankStock(bank.stock);
  }, [eventId]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  const { connected } = useEventSocket(status === "authenticated" ? eventId : null, () => refresh());
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  if (!overview) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 800 }}>
      <TeamNav eventId={eventId} />
      <h1>Inventory</h1>

      {!overview.myTeam ? (
        <p>Join a team first.</p>
      ) : (
        <>
          <h2>{overview.myTeam.name}'s materials</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Material</th>
                <th style={{ textAlign: "right" }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {inventory?.filter((i) => i.quantity !== 0).map((i) => (
                <tr key={i.materialTypeId}>
                  <td>{i.materialName}</td>
                  <td style={{ textAlign: "right" }}>{i.quantity}</td>
                </tr>
              ))}
              {inventory?.every((i) => i.quantity === 0) && (
                <tr>
                  <td colSpan={2} style={{ color: "#666" }}>No materials yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ marginTop: "2rem" }}>Bank stock (Stage 2)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Material</th>
            <th style={{ textAlign: "right" }}>Available</th>
            <th style={{ textAlign: "right" }}>Tax</th>
          </tr>
        </thead>
        <tbody>
          {bankStock?.map((s) => (
            <tr key={s.materialTypeId}>
              <td>{s.materialName}</td>
              <td style={{ textAlign: "right" }}>{s.availableQuantity}</td>
              <td style={{ textAlign: "right" }}>{s.isRare ? overview.settings.rareBankTaxPercent : overview.settings.normalBankTaxPercent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
