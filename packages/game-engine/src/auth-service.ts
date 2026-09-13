import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, eq } from "db";
import { participants } from "db/schema";
import { GameError } from "./errors";
import type { Tx } from "./tx";

// Task 1: replaces Google OAuth with admin-issued username + password
// logins — one shared credential per team, plus a handful of staff
// logins, not a public self-serve system (~20-30 accounts total, not
// thousands). Deliberately simple: bcrypt + a signed session cookie
// (packages/game-engine has no HTTP concerns, so the cookie itself is
// signed/read in frontend/src/lib/session.ts — this module only owns the
// credential and the server-side session_id it's checked against).
//
// Pattern studied from https://github.com/harshitchhabi/test_dream_team's
// password-auth implementation (api/handlers/auth.go, credentials.go,
// utils/password.go): bcrypt-hashed passwords, a random per-login
// session_id stored on the row and re-checked on every request (so a
// password reset or a new login instantly invalidates any older session
// for the same credential — "one shared credential per team" needs this,
// since a team could otherwise stay logged in on an old laptop after
// being reissued a new password), and a dummy-hash comparison on an
// unknown username so a login attempt takes roughly the same time
// whether the username exists or not.

const BCRYPT_ROUNDS = 10;
// No 0/O/1/I/l — a password read aloud across a noisy room, or typed on a
// phone, shouldn't hinge on telling those apart.
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const GENERATED_PASSWORD_LENGTH = 10;

// A precomputed real bcrypt hash of an arbitrary string, compared against
// whenever the username lookup itself fails — bcrypt.compare's cost is
// the same either way, so a login attempt against a nonexistent username
// takes about as long as one against a real username with a wrong
// password, rather than returning instantly and leaking which usernames
// exist.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function generatePassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

function randomSessionId(): string {
  return randomBytes(24).toString("hex");
}

// Creates one login credential row, inside the caller's transaction —
// used by createTeamLogin/createStaffLogin (team-service.ts) so the
// credential and the team/staff row it's attached to are created
// atomically. The password is generated here, returned once in plaintext
// for the admin screen to display, and never stored or logged anywhere
// except as its bcrypt hash.
export async function createLoginTx(tx: Tx, params: { name: string; username: string }) {
  const username = normalizeUsername(params.username);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new GameError("invalid_input", "Username must be 3-32 characters: letters, numbers, dots, dashes, or underscores.");
  }

  const [existing] = await tx.select({ id: participants.id }).from(participants).where(eq(participants.username, username));
  if (existing) throw new GameError("conflict", `The username "${username}" is already taken.`);

  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const [participant] = await tx
    .insert(participants)
    .values({ name: params.name, username, passwordHash })
    .returning();

  return { participant, password };
}

export async function login(params: { username: string; password: string }) {
  const username = normalizeUsername(params.username);
  const [participant] = await db.select().from(participants).where(eq(participants.username, username));

  const ok = await verifyPassword(params.password, participant?.passwordHash);
  if (!participant || !ok) {
    throw new GameError("unauthorized", "Incorrect username or password.");
  }

  const sessionId = randomSessionId();
  await db.update(participants).set({ sessionId }).where(eq(participants.id, participant.id));
  return { participant, sessionId };
}

export async function logout(participantId: string): Promise<void> {
  await db.update(participants).set({ sessionId: null }).where(eq(participants.id, participantId));
}

// Called on every authenticated request (via requireParticipant) to
// check the session cookie's sessionId still matches what's on the row —
// a mismatch means a newer login, an admin-forced password reset, or an
// explicit logout superseded this cookie, so it's refused even though it
// hasn't expired.
export async function verifySessionParticipant(participantId: string, sessionId: string) {
  if (!sessionId) return null;
  const [participant] = await db.select().from(participants).where(eq(participants.id, participantId));
  if (!participant || !participant.sessionId || participant.sessionId !== sessionId) return null;
  return participant;
}
