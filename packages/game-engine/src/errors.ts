// One error type for every rule violation the engine can raise, so every
// Next.js command endpoint can map it to an HTTP response the same way
// instead of each route inventing its own try/catch shape. `code` is
// machine-readable (for the client to decide what to show/disable);
// `message` is the human-readable reason that Section 7.3 requires to
// always accompany a disabled bid button ("Disable the bid button when the
// server declares it invalid; always show the reason.").
export type GameErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_event_stage"
  | "lot_not_live"
  | "bid_too_low"
  | "insufficient_tokens"
  | "trade_limit_reached"
  | "recipe_incomplete"
  | "already_has_city"
  | "invalid_input"
  | "conflict";

export class GameError extends Error {
  readonly code: GameErrorCode;

  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

export const HTTP_STATUS_BY_CODE: Record<GameErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_event_stage: 409,
  lot_not_live: 409,
  bid_too_low: 400,
  insufficient_tokens: 400,
  trade_limit_reached: 400,
  recipe_incomplete: 400,
  already_has_city: 409,
  invalid_input: 400,
  conflict: 409,
};
