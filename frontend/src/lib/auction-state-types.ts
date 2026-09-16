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
    quantity: number | null;
    openingBid: number;
    minimumRaise: number;
    closesAt: string | null;
    currentHighestBid: { id: string; amount: number; teamId: string } | null;
    nextMinimumBid: number;
  } | null;
  pendingLotsCount: number;
  // Staff-only (Task 2): the last few resolved lots in the current
  // round, so the moderator console can void a winning bid (force the
  // lot unsold) or reopen a lot for more bidding — dream_team's
  // AssignUnsoldToPlayers/reopen equivalent.
  recentLots: Array<{ id: string; lotNumber: number; status: string; winnerTeamName: string | null; winningBidId: string | null }>;
  teams: Array<{ id: string; name: string; auctionTokens: number | null; status: string }>;
}
