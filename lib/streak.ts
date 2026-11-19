/**
 * A day streak and a personal best per playlist, for a game of one.
 *
 * Since 2026-11-11 most games are one person alone from Google, mostly the
 * order game, and many play about three games and leave. With no accounts
 * (`docs/decisions.md` D1) the only "come back" this site can offer is one
 * the device remembers: how many days in a row it reached a Game Over, and
 * the best score it has made on this playlist.
 *
 * Two keys in the device's `localStorage`, nothing else:
 *
 *   - `guesssong_streak` — `{ day, count }`: the last *local* calendar day a
 *     one-player game reached Game Over, and the run of consecutive days that
 *     ends on it. Same day leaves it alone, the next day adds one, a gap
 *     starts again at one. A day earlier than the stored one (a clock set
 *     backwards, a phone crossing a date line) changes nothing: it must never
 *     grow the run, and resetting it would punish the traveller.
 *   - `guesssong_bests` — `[{ ref, score, at }]`: the best score per playlist,
 *     keyed by `playableRefOf`'s ref (the setup memory's key — a playlist's
 *     bare id, `album:<id>`, `artist:<id>`), at most `BESTS_MAX` entries,
 *     the least recently played evicted first, so storage stays bounded no
 *     matter how many playlists a device tries. A Mixed pool has no single
 *     link and so no best.
 *
 * Both are read field by field and repaired, never rejected wholesale — the
 * `parseGamePayload` and setup-memory rule, because storage survives deploys
 * and is editable. A corrupted streak with a readable day keeps its day; a
 * bests list keeps every entry that still reads.
 *
 * Written once per Game Over, from the same once-per-game guard that fires
 * the end beacon, and only for a game of one: a room's scoreboard is not
 * "your" best. A reload restarts at round one, so a second Game Over the same
 * day is possible — the streak is a set of days, so it cannot count twice.
 *
 * Pure rules first, in `lib/` for the usual reason (the suite cannot import a
 * page); the storage half goes through `lib/host-session.ts`'s guarded
 * helpers and never throws, because it runs inside the click that ends a game.
 */

import { readStored, writeStored } from "@/lib/host-session";
import { isPlayableRef } from "@/lib/playlist-ref";

export type StreakBand = "d1" | "d2" | "d3_6" | "d7_plus";

export const STREAK_BANDS: readonly StreakBand[] = ["d1", "d2", "d3_6", "d7_plus"];

export function isStreakBand(value: unknown): value is StreakBand {
  return typeof value === "string" && (STREAK_BANDS as readonly string[]).includes(value);
}

/**
 * How this game's score sat against the best stored for its playlist:
 * `first` when there was none (the score becomes it), `new` above it,
 * `tied` equal to it, `below` under it.
 */
export type BestOutcome = "new" | "tied" | "below" | "first";

export const BEST_OUTCOMES: readonly BestOutcome[] = ["new", "tied", "below", "first"];

export function isBestOutcome(value: unknown): value is BestOutcome {
  return typeof value === "string" && (BEST_OUTCOMES as readonly string[]).includes(value);
}

export const STREAK_KEY = "guesssong_streak";
export const BESTS_KEY = "guesssong_bests";

/** How many playlists keep a best. Thirty is a month of a new playlist a day. */
export const BESTS_MAX = 30;

/** Upper bounds a stored number may have before it reads as corrupted. */
const STREAK_COUNT_MAX = 100_000;
const SCORE_MAX = 100_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface StreakState {
  /** The last local calendar day counted, `YYYY-MM-DD`. */
  day: string;
  /** Consecutive days ending on `day`, at least 1. */
  count: number;
}

export interface BestEntry {
  /** `playableRefOf`'s ref. */
  ref: string;
  score: number;
  /** Epoch ms this playlist last reached a solo Game Over — the eviction order. */
  at: number;
}

/** The device's local calendar day, `YYYY-MM-DD` — what "a day" means to the person playing. */
export function localDayKey(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A day key as a whole day number, or null. Counted through `Date.UTC` on the
 * calendar fields, never by subtracting two local midnights: a DST change
 * makes one local day 23 or 25 hours long, and dividing by 24 hours would
 * round a real "next day" into a gap or a same day.
 */
export function dayNumber(day: string): number | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // 2026-02-31 would roll into March; a day that does not exist is not one.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / DAY_MS);
}

/** The run after a Game Over on `today`. */
export function nextStreak(prev: StreakState | null, today: string): StreakState {
  const todayN = dayNumber(today);
  if (todayN === null) return prev ?? { day: today, count: 1 };
  const prevN = prev ? dayNumber(prev.day) : null;
  if (!prev || prevN === null) return { day: today, count: 1 };
  const gap = todayN - prevN;
  // Same day, or a day before the stored one: unchanged. A clock set
  // backwards must not grow the run, and moving the stored day back would let
  // the clock being corrected count as a new day.
  if (gap <= 0) return prev;
  if (gap === 1) return { day: today, count: Math.min(prev.count + 1, STREAK_COUNT_MAX) };
  return { day: today, count: 1 };
}

export function streakBand(count: number): StreakBand {
  if (count >= 7) return "d7_plus";
  if (count >= 3) return "d3_6";
  if (count === 2) return "d2";
  return "d1";
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= SCORE_MAX;
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * The best for `ref` after this game, and the list to store. The entry is
 * touched on every outcome, so eviction drops the playlist least recently
 * played rather than the one whose best is oldest.
 */
export function nextBest(
  entries: readonly BestEntry[],
  ref: string,
  score: number,
  now: number
): { outcome: BestOutcome; best: number; previous: number | null; entries: BestEntry[] } {
  const safeScore = isScore(score) ? score : 0;
  const existing = entries.find((e) => e.ref === ref);
  const rest = entries.filter((e) => e.ref !== ref);
  let outcome: BestOutcome;
  let best: number;
  if (!existing) {
    outcome = "first";
    best = safeScore;
  } else if (safeScore > existing.score) {
    outcome = "new";
    best = safeScore;
  } else {
    outcome = safeScore === existing.score ? "tied" : "below";
    best = existing.score;
  }
  const next = [{ ref, score: best, at: now }, ...rest]
    .sort((a, b) => b.at - a.at)
    .slice(0, BESTS_MAX);
  return { outcome, best, previous: existing ? existing.score : null, entries: next };
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The stored run, repaired: a readable day with a bad count keeps the day at
 * a count of one; an unreadable day is no run at all.
 */
export function parseStreak(raw: string | null): StreakState | null {
  const data = parseJson(raw);
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.day !== "string" || dayNumber(d.day) === null) return null;
  const count =
    typeof d.count === "number" && Number.isSafeInteger(d.count) && d.count >= 1 && d.count <= STREAK_COUNT_MAX
      ? d.count
      : 1;
  return { day: d.day, count };
}

/**
 * The stored bests, repaired entry by entry: anything that does not read is
 * dropped and the rest kept, a duplicate ref keeps its higher score, and the
 * list is trimmed to `BESTS_MAX` most recent.
 */
export function parseBests(raw: string | null): BestEntry[] {
  const data = parseJson(raw);
  if (!Array.isArray(data)) return [];
  const byRef = new Map<string, BestEntry>();
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (!isPlayableRef(e.ref) || !isScore(e.score)) continue;
    const entry: BestEntry = { ref: e.ref, score: e.score, at: isEpoch(e.at) ? e.at : 1 };
    const seen = byRef.get(entry.ref);
    if (!seen || entry.score > seen.score) {
      byRef.set(entry.ref, { ...entry, at: Math.max(entry.at, seen?.at ?? 0) });
    }
  }
  return [...byRef.values()].sort((a, b) => b.at - a.at).slice(0, BESTS_MAX);
}

/** What one solo Game Over came to: for the line on screen and the end beacon. */
export interface StreakResult {
  streak: number;
  band: StreakBand;
  /** Null when the game has no single playlist (a Mixed pool, a short link). */
  best: { outcome: BestOutcome; score: number; best: number; previous: number | null } | null;
}

/**
 * Reads both keys, decides, writes them back. Never throws: every storage
 * call is guarded, and a browser that keeps nothing sees day one and a first
 * score every game — honest about what this device remembers.
 */
export function takeStreakResult(
  input: { ref: string | null | undefined; score: number },
  now: Date = new Date()
): StreakResult {
  const streak = nextStreak(parseStreak(readStored(STREAK_KEY)), localDayKey(now));
  writeStored(STREAK_KEY, JSON.stringify(streak));
  let best: StreakResult["best"] = null;
  if (isPlayableRef(input.ref)) {
    const score = isScore(input.score) ? input.score : 0;
    const next = nextBest(parseBests(readStored(BESTS_KEY)), input.ref, score, now.getTime());
    writeStored(BESTS_KEY, JSON.stringify(next.entries));
    best = { outcome: next.outcome, score, best: next.best, previous: next.previous };
  }
  return { streak: streak.count, band: streakBand(streak.count), best };
}

/** A playlist name short enough to share a line, cut by code point. */
function shortName(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length > 28 ? `${chars.slice(0, 27).join("")}…` : chars.join("");
}

/**
 * The line under the scores. "🔥 3-day streak · Best on Decades: 9 — new best!"
 * Day one says what a streak is instead of claiming one.
 */
export function streakLine(result: StreakResult, playlistName: string, locale: "en" | "pt" = "en"): string {
  if (locale === "pt") return streakLinePt(result, playlistName);
  const parts = [
    result.streak <= 1 ? "Day 1 — come back tomorrow to start a streak" : `🔥 ${result.streak}-day streak`,
  ];
  const name = shortName(playlistName);
  if (result.best && name) {
    const { outcome, best } = result.best;
    const suffix =
      outcome === "new" ? " — new best!" : outcome === "tied" ? " — tied your best" : outcome === "first" ? " — beat it next time" : "";
    parts.push(`Best on ${name}: ${best}${suffix}`);
  }
  return parts.join(" · ");
}

/**
 * `streakLine` for a game started from the Portuguese setup page (the game
 * payload's `locale`, `lib/order-copy.ts`).
 */
function streakLinePt(result: StreakResult, playlistName: string): string {
  const parts = [
    result.streak <= 1 ? "Dia 1 — volte amanhã para começar uma sequência" : `🔥 ${result.streak} dias seguidos`,
  ];
  const name = shortName(playlistName);
  if (result.best && name) {
    const { outcome, best } = result.best;
    const suffix =
      outcome === "new"
        ? " — novo recorde!"
        : outcome === "tied"
        ? " — igualou seu recorde"
        : outcome === "first"
        ? " — tente superar na próxima"
        : "";
    parts.push(`Recorde em ${name}: ${best}${suffix}`);
  }
  return parts.join(" · ");
}
