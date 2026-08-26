// Shared shape returned by GET /api/events/:id/auction-state — see that
// route for what's stripped for non-staff callers.
export interface AuctionStateResponse {
  eventStatus: string;
  isStaff: boolean;
  myTeamId: string | null;
  myRole: "leader" | "member" | null;
  activeRound: {
    id: string;
    sequence: number;
    materialKey?: string;
    materialName?: string;
    shock: { title: string; description: string } | null;
  } | null;
  liveLot: {
    id: string;
    lotNumber: number;
    materialKey?: string;
    materialName?: string;
    openingBid: number;
    minimumRaise: number;
    closesAt: string | null;
    currentHighestBid: { amount: number; teamId: string } | null;
    nextMinimumBid: number;
  } | null;
  pendingLotsCount: number;
  teams: Array<{ id: string; name: string; auctionTokens: number | null; status: string }>;
}
