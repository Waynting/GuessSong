/**
 * What this device remembers about the quiz it last made.
 *
 * The link is the owner's only handle on the board — there is no account to
 * list "my quizzes" under (docs/decisions.md D1), and a host who closes the tab
 * has lost it unless the device kept it. So the setup page keeps the last one,
 * and offers it back as "see who knows you best". One entry, not a history:
 * the question this answers is "where did my link go", not "what have I made".
 *
 * Same storage guard as `lib/host-session.ts`, for the same reasons: the setup
 * page is prerendered where `window` does not exist, and storage *throws* in a
 * locked-down browser rather than returning null.
 */

import { withStorage } from "@/lib/host-session";
import { ROOM_CODE_ALPHABET } from "@/types/room";
import { QUIZ_CODE_LENGTH, QUIZ_TTL_SECONDS } from "@/types/quiz";

const LAST_QUIZ_KEY = "guesssong_last_quiz";
const TOKENS_KEY = "guesssong_quiz_tokens";
/** Host tokens kept per device. Ten is well past "the quizzes still alive". */
export const QUIZ_TOKENS_MAX = 10;

/** The same shape rule the store applies, built from the same constants. */
const CODE_SHAPE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${QUIZ_CODE_LENGTH}}$`);

export interface LastQuiz {
  code: string;
  ownerName: string | null;
  playlistName: string;
  createdAt: number;
  expiresAt: number;
}

export function rememberLastQuiz(quiz: LastQuiz): void {
  withStorage((storage) => storage.setItem(LAST_QUIZ_KEY, JSON.stringify(quiz)), undefined);
}

/** The last quiz this device made, or null once it has expired or never existed. */
export function recallLastQuiz(now = Date.now()): LastQuiz | null {
  return withStorage((storage) => {
    const raw = storage.getItem(LAST_QUIZ_KEY);
    if (!raw) return null;
    const parsed = parseLastQuiz(raw, now);
    if (!parsed) storage.removeItem(LAST_QUIZ_KEY);
    return parsed;
  }, null);
}

/**
 * Pure, so the shape rules have a test. Tolerant of the fields a later build
 * might add and strict about the two it cannot do without: a code to link to
 * and an expiry to stop linking at. An expiry further out than the TTL allows
 * is corruption, not a longer quiz.
 */
export function parseLastQuiz(raw: string, now = Date.now()): LastQuiz | null {
  try {
    const value = JSON.parse(raw) as Partial<LastQuiz> | null;
    if (!value || typeof value !== "object") return null;
    if (typeof value.code !== "string") return null;
    const code = value.code.toUpperCase();
    if (!CODE_SHAPE.test(code)) return null;
    if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return null;
    if (value.expiresAt <= now) return null;
    if (value.expiresAt > now + QUIZ_TTL_SECONDS * 1000) return null;
    return {
      code,
      ownerName: typeof value.ownerName === "string" ? value.ownerName : null,
      playlistName: typeof value.playlistName === "string" ? value.playlistName : "",
      createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * The host token for each quiz this device made.
 *
 * Separate from `LastQuiz` because that is one entry and the board page has
 * to work for the quiz before last too. The token is what `/api/quiz/[code]/
 * board` wants, and this is the only place it exists outside KV — there is no
 * account to attach it to, so "the device that made it" is the owner.
 *
 * An array with a timestamp, not a code-keyed object. Pruning "the oldest"
 * off an object relied on insertion order, and JavaScript enumerates
 * integer-like keys first regardless — a code can be all digits here
 * (`2-9` are in the alphabet), so the *newest* all-digit code was the one
 * pruned, and its owner lost their own results page. Confirmed before the
 * change; `tests/quiz-session.test.ts` pins it.
 */
export interface QuizTokenEntry {
  code: string;
  token: string;
  /** When it was remembered. What pruning orders by. */
  at: number;
}

export function rememberQuizToken(code: string, hostToken: string, now = Date.now()): void {
  withStorage((storage) => {
    const upper = code.toUpperCase();
    const kept = parseQuizTokens(storage.getItem(TOKENS_KEY)).filter((e) => e.code !== upper);
    const next = pruneQuizTokens([...kept, { code: upper, token: hostToken, at: now }]);
    storage.setItem(TOKENS_KEY, JSON.stringify(next));
  }, undefined);
}

export function recallQuizToken(code: string): string | null {
  const upper = code.toUpperCase();
  return withStorage(
    (storage) => parseQuizTokens(storage.getItem(TOKENS_KEY)).find((e) => e.code === upper)?.token ?? null,
    null
  );
}

/** Pure, so the shape rules have a test: well-formed entries only, in stored order. */
export function parseQuizTokens(raw: string | null): QuizTokenEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: QuizTokenEntry[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const { code, token, at } = item as Partial<QuizTokenEntry>;
      if (typeof code !== "string" || !CODE_SHAPE.test(code)) continue;
      if (typeof token !== "string" || !token) continue;
      out.push({ code, token, at: typeof at === "number" && Number.isFinite(at) ? at : 0 });
    }
    return out;
  } catch {
    return [];
  }
}

/** Keeps the `QUIZ_TOKENS_MAX` most recently remembered, by timestamp. */
export function pruneQuizTokens(entries: readonly QuizTokenEntry[]): QuizTokenEntry[] {
  return [...entries].sort((a, b) => a.at - b.at).slice(Math.max(0, entries.length - QUIZ_TOKENS_MAX));
}

/**
 * The link to send. This origin, not production: the quiz record lives in
 * whichever KV this deployment writes to, and a preview deploy's quiz does not
 * exist on production. Same reasoning as `roomJoinUrl`.
 */
export function quizUrl(code: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.guessong.app";
  return `${base.replace(/\/$/, "")}/q/${code.toUpperCase()}`;
}
