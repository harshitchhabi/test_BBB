// Shared fetch helper for client components' polling/refresh loops.
//
// Several screens used to do `fetch(url).then(r => r.json())` with no
// check on r.ok. On a non-2xx response (an expired session, a transient
// 500, a 403 for a teamless staff account) that either throws on a
// non-JSON body or — worse — silently hands back an error object
// (`{error, message}`) that the caller then treats as real data, so
// `overview.myTeam` etc. all read `undefined` and the screen renders a
// misleading blank/empty state instead of an explanation. This is the
// same bug class already fixed on the auction and event-home screens;
// `fetchJson` centralizes the fix so every screen's refresh loop gets it.
export class FetchJsonError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FetchJsonError(body?.message ?? `Request failed (${res.status}).`, res.status);
  }
  return body as T;
}
