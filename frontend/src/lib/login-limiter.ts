// In-memory login-attempt rate limiter — same shape as
// https://github.com/harshitchhabi/test_dream_team's LoginLimiter
// (api/handlers/loginlimit.go): a per-account limit (so guessing one
// team's password gets throttled fast) and a looser per-IP limit (so one
// address can't just spray usernames). In-memory is fine here — this
// deploys as one Node process per event, no multi-instance/Redis needed.
interface AttemptRecord {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const ACCOUNT_ATTEMPTS = 10;
const ACCOUNT_WINDOW_MS = 60_000;
const ACCOUNT_LOCKOUT_MS = 120_000;

const ADDRESS_ATTEMPTS = 60;
const ADDRESS_WINDOW_MS = 60_000;
const ADDRESS_LOCKOUT_MS = 120_000;

const attempts = new Map<string, AttemptRecord>();

function allow(key: string, limit: number, windowMs: number, lockoutMs: number, now: number): { ok: boolean; waitMs: number } {
  const rec = attempts.get(key);
  if (!rec) {
    attempts.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    sweep(now);
    return { ok: true, waitMs: 0 };
  }
  if (now < rec.lockedUntil) return { ok: false, waitMs: rec.lockedUntil - now };
  if (now - rec.windowStart > windowMs) {
    rec.count = 1;
    rec.windowStart = now;
    return { ok: true, waitMs: 0 };
  }
  rec.count++;
  if (rec.count > limit) {
    rec.lockedUntil = now + lockoutMs;
    return { ok: false, waitMs: lockoutMs };
  }
  return { ok: true, waitMs: 0 };
}

function sweep(now: number) {
  if (attempts.size < 1024) return;
  for (const [key, rec] of attempts) {
    if (now - rec.windowStart > ACCOUNT_WINDOW_MS && now > rec.lockedUntil) attempts.delete(key);
  }
}

// The account lockout is keyed on the username ALONE, not combined with
// the address — the address header (see clientAddress below) comes from
// the client and isn't trustworthy unless the deployment is known to sit
// behind a proxy that overwrites it, so the one lockout that actually has
// to hold under a spoofed address is the one that never looks at it. The
// address-keyed lockout is a secondary, looser layer (catches one address
// spraying many usernames) — its own bypassability by header spoofing
// only weakens that secondary layer, not the account-brute-force defense.
export function checkLoginAllowed(username: string, address: string): { ok: boolean; waitSeconds: number } {
  const now = Date.now();
  const byAddress = allow(`a:${address}`, ADDRESS_ATTEMPTS, ADDRESS_WINDOW_MS, ADDRESS_LOCKOUT_MS, now);
  if (!byAddress.ok) return { ok: false, waitSeconds: Math.ceil(byAddress.waitMs / 1000) };
  const byAccount = allow(`u:${username.toLowerCase()}`, ACCOUNT_ATTEMPTS, ACCOUNT_WINDOW_MS, ACCOUNT_LOCKOUT_MS, now);
  return { ok: byAccount.ok, waitSeconds: Math.ceil(byAccount.waitMs / 1000) };
}

export function recordLoginSuccess(username: string) {
  attempts.delete(`u:${username.toLowerCase()}`);
}

// TRUST_PROXY_HEADERS opts in to reading X-Forwarded-For, for a
// deployment that's actually behind a reverse proxy configured to
// overwrite (not append to) that header. Without it, every request is
// bucketed under one shared "unknown" address — which only weakens the
// secondary per-address layer above, since the primary per-account
// lockout (checkLoginAllowed) never depends on this value.
export function clientAddress(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "unknown";
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}
