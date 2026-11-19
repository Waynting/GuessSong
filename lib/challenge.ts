/**
 * "Beat my score": a one-player order game, sent to a friend who plays the
 * same deal.
 *
 * Most games are one person alone playing "Put them in order", and a plain
 * invitation converted 1 send in 2,089 (`solo_invite`). A score to beat is a
 * reason to open the link today rather than "next time we hang out". The
 * friend plays the *same deal* — same playlist, same shuffle — and the Game
 * Over puts the two scores side by side.
 *
 * ## Same deal = same playlist + same seed + same count
 *
 * The setup page shuffles before it stores (`shuffle` and `pickSpread` in
 * `lib/shuffle.ts`), and `buildOrderRounds` is deterministic over the stored
 * array, so the deal is fixed by three things: the track list the playlist
 * loads as, the random stream the two shuffles draw from, and how many songs
 * were picked. A solo order game draws its stream from `seededRandom(seed)`
 * with a fresh `seed` per game, and the link carries the seed and the count.
 *
 * **The honest gap.** The friend's playlist load can differ from the
 * challenger's: the owner added or removed a song, or the playlist cache
 * refreshed between the two loads (`lib/playlist-cache.ts`, 24h freshness).
 * A different list under the same seed is a different deal, and the two
 * scores are then about different cards. Accepted, not built around: a party
 * toy, and storing the deal would put a track list in a URL or in KV for a
 * link that may never be opened. The friend's load is a real Spotify load
 * only on a cache miss, which a playlist played minutes ago mostly is not.
 *
 * Pure and dependency-light — `lib/playlist-ref.ts` and `lib/loop-links.ts`
 * only — because the setup page, the order page, `lib/game-session.ts` and
 * the `/r/[surface]` route all read it. Nothing here may reach `lib/kv.ts`.
 *
 * **No names in the URL.** The link travels to group chats; it carries a
 * playlist ref, a seed and three small numbers, all re-validated on the way
 * through `/r/challenge` and again on the setup page.
 */

import { loopUrl } from "@/lib/loop-links";
import { isEditorialId, isPlayableRef, playableRefOf, playableUrlOf } from "@/lib/playlist-ref";
import { ORDER_EXACT_POINTS, ORDER_OLDEST_POINTS } from "@/lib/order-game";
import { SONG_COUNT_CONTROL } from "@/lib/song-count";

/** A seed is a uint32: what mulberry32 takes, and ten digits at most on the wire. */
export const SEED_MAX = 0xffffffff;

export function isSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= SEED_MAX;
}

/**
 * mulberry32: a small, fast, well-mixed 32-bit PRNG. Deterministic over its
 * seed on every engine, which is the whole requirement — the friend's browser
 * must draw exactly the stream the challenger's did. Not for anything secret.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fresh seed for a new solo order game. `getRandomValues` where there is
 * one, `Math.random` otherwise — the `mintPlayerId` rule: an old phone without
 * the API must still start a game, not reach the crash screen.
 */
export function freshSeed(): number {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === "function") {
      return c.getRandomValues(new Uint32Array(1))[0];
    }
  } catch {
    // Fall through to Math.random.
  }
  return Math.floor(Math.random() * (SEED_MAX + 1)) >>> 0;
}

/**
 * The best a solo order game of `rounds` rounds can score: every round's
 * whole order (`ORDER_EXACT_POINTS`) plus the oldest card on top, which a
 * whole order always has (`ORDER_OLDEST_POINTS`) — the order page awards both
 * to a player of one.
 */
export function soloOrderMaxScore(rounds: number): number {
  const n = Number.isFinite(rounds) ? Math.max(0, Math.trunc(rounds)) : 0;
  return n * (ORDER_EXACT_POINTS + ORDER_OLDEST_POINTS);
}

/**
 * Bounds for the numbers a link may carry. `CHALLENGE_SCORE_MAX` is far
 * above any real deal (500 songs is 125 rounds, 500 points) and exists so a
 * hand-edited link cannot put a twelve-digit score on the friend's screen.
 */
export const CHALLENGE_SCORE_MAX = 1000;

/** The challenger's result, as the friend's payload carries it. */
export interface ChallengeScore {
  score: number;
  max: number;
}

function isSmallInt(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

export function isChallengeScore(value: unknown): value is ChallengeScore {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isSmallInt(v.max, CHALLENGE_SCORE_MAX) &&
    v.max > 0 &&
    isSmallInt(v.score, CHALLENGE_SCORE_MAX) &&
    v.score <= v.max
  );
}

/** Everything a challenge link names: the deal, and the score to beat. */
export interface ChallengeDeal extends ChallengeScore {
  /** The playable ref (`playableRefOf`): a bare playlist id, `album:<id>` or `artist:<id>`. */
  ref: string;
  seed: number;
  /** How many songs the challenger's game picked — the pick is part of the deal. */
  count: number;
}

/**
 * A ref a link may name: one `playableRefOf` would produce from its own
 * canonical address — i.e. the classifier (`lib/spotify-link.ts`) reads it
 * back as itself — and never an editorial playlist, which the server refuses.
 */
export function isChallengeRef(value: unknown): value is string {
  if (!isPlayableRef(value)) return false;
  if (isEditorialId(value)) return false;
  return playableRefOf(playableUrlOf(value)) === value;
}

const DIGITS = /^\d{1,10}$/;

function parseUint(raw: string, max: number): number | null {
  if (!DIGITS.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= max ? n : null;
}

/**
 * The numbers half of a link: `<seed>.<score>.<max>.<count>`. One parameter
 * rather than four so a link cut short by a chat app loses the whole
 * challenge, never half of it.
 */
export function encodeChallengeToken(deal: Omit<ChallengeDeal, "ref">): string {
  return `${deal.seed}.${deal.score}.${deal.max}.${deal.count}`;
}

export function parseChallengeToken(raw: unknown): Omit<ChallengeDeal, "ref"> | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const seed = parseUint(parts[0], SEED_MAX);
  const score = parseUint(parts[1], CHALLENGE_SCORE_MAX);
  const max = parseUint(parts[2], CHALLENGE_SCORE_MAX);
  const count = parseUint(parts[3], SONG_COUNT_CONTROL.max);
  if (seed === null || score === null || max === null || count === null) return null;
  if (!isChallengeScore({ score, max })) return null;
  if (count < SONG_COUNT_CONTROL.min) return null;
  return { seed, score, max, count };
}

/** Query names on `/r/challenge`: the ref and the token. */
export const CHALLENGE_REF_PARAM = "p";
export const CHALLENGE_TOKEN_PARAM = "c";

/**
 * The link the Game Over shares: the counting redirect's production URL
 * (`loopUrl`, never the tab's) with the ref and the token.
 */
export function challengeShareUrl(deal: ChallengeDeal): string {
  const query = new URLSearchParams({
    [CHALLENGE_REF_PARAM]: deal.ref,
    [CHALLENGE_TOKEN_PARAM]: encodeChallengeToken(deal),
  });
  return `${loopUrl("challenge")}?${query.toString()}`;
}

/**
 * What `/r/challenge` forwards to the setup page, re-validated: the
 * canonical playlist address as `?playlist=` (the param the setup page
 * already fills the field from) and the token as `?challenge=`. Null when
 * either half is junk — the redirect still happens and still counts, it just
 * lands on a plain form.
 */
export function challengeLandingQuery(query: URLSearchParams): string | null {
  const ref = query.get(CHALLENGE_REF_PARAM);
  const token = parseChallengeToken(query.get(CHALLENGE_TOKEN_PARAM));
  if (!isChallengeRef(ref) || !token) return null;
  const out = new URLSearchParams({ playlist: playableUrlOf(ref), challenge: encodeChallengeToken(token) });
  return out.toString();
}

/**
 * The challenge the setup page should offer, read off its own URL: both
 * `?playlist=` (through the classifier) and `?challenge=` must be valid.
 */
export function parseChallengeArrival(query: URLSearchParams): ChallengeDeal | null {
  const token = parseChallengeToken(query.get("challenge"));
  if (!token) return null;
  const ref = playableRefOf(query.get("playlist") ?? "");
  if (!isChallengeRef(ref)) return null;
  return { ref, ...token };
}

export type ChallengeVerdict = "won" | "lost" | "tied";

export const CHALLENGE_VERDICTS: readonly ChallengeVerdict[] = ["won", "lost", "tied"];

export function challengeVerdict(mine: number, theirs: number): ChallengeVerdict {
  if (mine > theirs) return "won";
  if (mine < theirs) return "lost";
  return "tied";
}

/**
 * What the `challenge` pulse may carry: the share sheet's outcome and the
 * friend's result. `started` is counted from the `game_started` pulse and is
 * deliberately not here, so no second path can count a start.
 */
export const CHALLENGE_STEPS = [
  "share:shared",
  "share:copied",
  "share:dismissed",
  "share:failed",
  ...CHALLENGE_VERDICTS,
] as const;

export type ChallengeStep = (typeof CHALLENGE_STEPS)[number];

export function isChallengeStep(value: unknown): value is ChallengeStep {
  return typeof value === "string" && (CHALLENGE_STEPS as readonly string[]).includes(value);
}

// ── Copy: the setup banner is in lib/setup-copy.ts's table; the Game Over
// card's lines below speak the order page's two languages ─────────────────

export function challengeBanner(score: number, max: number): string {
  return `Your friend scored ${score} of ${max} on this playlist — beat it`;
}

/*
 * The Game Over card's words take the game payload's locale
 * (`lib/order-copy.ts`): a game started from the Portuguese setup page gets
 * them in Portuguese, the share text included — the friend is most likely in
 * the same chat, reading the same language.
 */
export function challengeButtonLabel(score: number, answering: boolean, locale: "en" | "pt" = "en"): string {
  if (locale === "pt") return answering ? `Mande de volta: supere meus ${score}` : `Desafie um amigo: supere meus ${score}`;
  return answering ? `Send it back: beat my ${score}` : `Challenge a friend: beat my ${score}`;
}

export function challengeShareText(score: number, max: number, locale: "en" | "pt" = "en"): string {
  if (locale === "pt") {
    return `Fiz ${score} de ${max} pondo estas músicas na ordem de lançamento. Mesmas músicas, sua vez — consegue superar? Grátis, sem app.`;
  }
  return `I got ${score} of ${max} putting these songs in release order. Same songs, your turn — can you beat it? Free, no app.`;
}

export function challengeResultLine(mine: number, theirs: number, locale: "en" | "pt" = "en"): string {
  const verdict = challengeVerdict(mine, theirs);
  if (locale === "pt") {
    const tail = verdict === "won" ? "você venceu!" : verdict === "lost" ? "seu amigo venceu" : "empate";
    return `Você ${mine} · Seu amigo ${theirs} — ${tail}`;
  }
  const tail = verdict === "won" ? "you win!" : verdict === "lost" ? "your friend wins" : "a tie";
  return `You ${mine} · Your friend ${theirs} — ${tail}`;
}
