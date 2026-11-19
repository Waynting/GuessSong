/**
 * The daily challenge: five songs, the same for everyone each UTC day, put in
 * release order — and a grid to paste into a chat.
 *
 * ## Why it exists
 *
 * The "Today's challenge" fake door on the setup page (2026-11-17 → 11-19)
 * read 7.8% of page loads tapped (1,578 of 20,177) against a 3% bar. Most
 * visitors are one person alone from Google playing the order game on the
 * decades starter, and the music-age card had shown that people alone do share
 * a result about themselves (1.1% of shown sent) where they will not send an
 * invitation (`solo_invite`, ~0.05%). The "beat my score" link read zero
 * friends started; this replaces it as the shared-deal mechanic.
 *
 * ## The deal
 *
 *   - **Day:** the UTC date, `YYYY-MM-DD` (`utcDayKey`). UTC and not local, so
 *     "today's" is one deal worldwide and two friends in different time zones
 *     who compare grids played the same cards — at the cost of the day turning
 *     over at 21:00 in Brasília.
 *   - **Number:** days since `DAILY_EPOCH` (2026-11-19, the day it shipped, is #1).
 *   - **Seed:** FNV-1a over the day string (`dailySeed`), fed to mulberry32
 *     (`seededRandom` in lib/challenge.ts) — stable on every engine.
 *   - **Source:** the `decades` starter (`DAILY_PLAYLIST_ID`), loaded through
 *     `POST /api/playlist` like any other link, so it is `loadPlaylist`'s cache
 *     that serves it: one Spotify load per cache window for the whole site.
 *     On 2026-11-19 it loaded as 385 songs, 348 usable over 61 distinct
 *     years — the pick held a 3-year gap or wider on each of its first 30
 *     days. Under `MAX_PLAYLIST_TRACKS`, so never sampled,
 *     and the load returns them in playlist order — the input every device
 *     shuffles is the same list. The honest gap is `lib/challenge.ts`'s: an
 *     owner edit or a cache refresh mid-day changes the list, and with it the
 *     deal. Accepted for a party toy; the owner holds the playlist.
 *   - **Pick (`pickDaily`):** the usable tracks (`usableOrderTracks` — dated,
 *     not a compilation), seeded-shuffled, then five taken greedily in that
 *     order with pairwise year gaps of `ORDER_PREFERRED_YEAR_GAP`, stepping
 *     the gap down to 1 (distinct years) only if the wider gap cannot fill
 *     five. The same ladder the order game deals with
 *     (`buildOrderRounds`), applied to one round: that function compares
 *     whole multi-round deals, which has no meaning for a single round of
 *     five, so the ladder is restated here rather than bent to fit.
 *   - **Round:** one round of five cards in the pick's order — the payload's
 *     order is the deal (`dailyRound`), never re-shuffled on the order page.
 *
 * Pure apart from the two storage helpers, which go through
 * lib/host-session.ts's guarded calls and never throw. Imported by the setup
 * page, the order page, lib/game-session.ts and lib/loop-stats.ts, so nothing
 * here may reach lib/kv.ts.
 */

import type { Track } from "@/types";
import { seededRandom } from "@/lib/challenge";
import { shuffle } from "@/lib/shuffle";
import { loopUrl } from "@/lib/loop-links";
import { readStored, writeStored } from "@/lib/host-session";
import { ORDER_PREFERRED_YEAR_GAP, releaseYear, trueOrder, usableOrderTracks, type OrderRound } from "@/lib/order-game";

/** Day #1: the day it shipped. */
export const DAILY_EPOCH = "2026-11-19";

/** Cards in the day's one round. */
export const DAILY_SIZE = 5;

/**
 * The decades starter's id (lib/starter-playlists.ts), restated so this module
 * does not pull the starter table into the order page's bundle;
 * `tests/daily.test.ts` pins that the two agree.
 */
export const DAILY_PLAYLIST_ID = "0RRc1JAhWKFm7QSWGiI5y8";

/**
 * Where a daily game is played: always the order game. A constant rather than
 * a literal at the call site, for the setup page's rule that no start spells
 * `/game` or `/order` by hand (tests/setup-assist.test.ts).
 */
export const DAILY_GAME_HREF = "/order";

/** localStorage: this device's result for the day (`DailyResult`). */
export const DAILY_STORAGE_KEY = "guesssong_daily";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC date of `now`, as `YYYY-MM-DD`. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function dayEpochMs(day: string): number | null {
  const m = DAY_KEY.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rejects 2026-02-30 and friends: the date must read back as itself.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && dayEpochMs(value) !== null;
}

/** The challenge's number for `day`, or null before day #1 or for junk. */
export function dailyNumber(day: string): number | null {
  const ms = dayEpochMs(day);
  const epoch = dayEpochMs(DAILY_EPOCH) as number;
  if (ms === null || ms < epoch) return null;
  return Math.round((ms - epoch) / DAY_MS) + 1;
}

/** A uint32 seed from the day string: FNV-1a, 32-bit. */
export function dailySeed(day: string): number {
  let h = 0x811c9dc5;
  const s = `guesssong-daily:${day}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Five greedily, in order, every pair at least `gap` years apart; null when it cannot. */
function pickWithGap<T extends Pick<Track, "releaseDate">>(pool: readonly T[], gap: number): T[] | null {
  const picked: T[] = [];
  const years: number[] = [];
  for (const track of pool) {
    const year = releaseYear(track) as number;
    if (years.every((y) => Math.abs(y - year) >= gap)) {
      picked.push(track);
      years.push(year);
      if (picked.length === DAILY_SIZE) return picked;
    }
  }
  return null;
}

/**
 * The day's five cards from the loaded playlist, in deal order, or null when
 * the list has fewer than five usable distinct years — the setup page then
 * refuses with `daily_unavailable` and stores nothing.
 */
export function pickDaily<T extends Pick<Track, "releaseDate" | "albumCompilation">>(
  tracks: readonly T[],
  seed: number
): T[] | null {
  const pool = shuffle(usableOrderTracks(tracks), seededRandom(seed));
  for (let gap = ORDER_PREFERRED_YEAR_GAP; gap >= 1; gap--) {
    const picked = pickWithGap(pool, gap);
    if (picked) return picked;
  }
  return null;
}

/**
 * The order page's deal for a daily payload: exactly one round of the stored
 * five, in stored order. Null when the stored list is not five usable cards
 * with distinct years — a hand-edited payload — and the page then plays it as
 * an ordinary order game.
 */
export function dailyRound<T extends Pick<Track, "releaseDate" | "albumCompilation">>(
  tracks: readonly T[]
): OrderRound<T> | null {
  if (tracks.length !== DAILY_SIZE) return null;
  if (usableOrderTracks(tracks).length !== DAILY_SIZE) return null;
  const years = new Set(tracks.map((t) => releaseYear(t)));
  if (years.size !== DAILY_SIZE) return null;
  return { tracks: [...tracks] };
}

/** Per slot, top to bottom: is the card the player left there the one that belongs there? */
export function dailyGrid<T extends Pick<Track, "id" | "releaseDate">>(
  arrangedIds: readonly string[],
  round: OrderRound<T>
): boolean[] {
  return trueOrder(round).map((t, i) => arrangedIds[i] === t.id);
}

export function gridScore(grid: readonly boolean[]): number {
  return grid.filter(Boolean).length;
}

export function gridEmoji(grid: readonly boolean[]): string {
  return grid.map((ok) => (ok ? "🟩" : "⬛")).join("");
}

/**
 * `GuessSong Daily #12 🟩🟩⬛🟩🟩 4/5` — no name, no song titles. A game from
 * the Portuguese setup page shares `GuessSong Desafio #12 …`: the friend is
 * most likely in the same chat, reading the same language, and the grid and
 * `#N k/5` stay identical so the two compare at a glance. The page's other
 * daily words are `ORDER_COPY[locale].daily` (lib/order-copy.ts).
 */
export function dailyShareText(number: number, grid: readonly boolean[], locale: "en" | "pt" = "en"): string {
  const name = locale === "pt" ? "Desafio" : "Daily";
  return `GuessSong ${name} #${number} ${gridEmoji(grid)} ${gridScore(grid)}/${grid.length}`;
}

/** What the clipboard gets: the line, a newline, the counting redirect's production URL. */
export function dailyShareMessage(number: number, grid: readonly boolean[], locale: "en" | "pt" = "en"): string {
  return `${dailyShareText(number, grid, locale)}\n${loopUrl("daily")}`;
}

// ── The payload field ──────────────────────────────────────────────────────

/** What a daily game's payload carries (`GamePayload.daily`). */
export interface DailyTag {
  day: string;
  number: number;
}

/** Valid only when the number is the day's own; anything else is dropped by `parseGamePayload`. */
export function parseDailyTag(value: unknown): DailyTag | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isDayKey(v.day)) return null;
  const number = dailyNumber(v.day);
  if (number === null || v.number !== number) return null;
  return { day: v.day, number };
}

// ── Once a day per device ──────────────────────────────────────────────────

export interface DailyResult {
  day: string;
  grid: boolean[];
  score: number;
}

/**
 * Read back and repaired: the score is recounted from the grid rather than
 * trusted, and anything that is not a day and five booleans is no result.
 */
export function parseDailyResult(raw: string | null): DailyResult | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!isDayKey(d.day) || dailyNumber(d.day) === null) return null;
  if (!Array.isArray(d.grid) || d.grid.length !== DAILY_SIZE || !d.grid.every((c) => typeof c === "boolean")) {
    return null;
  }
  const grid = d.grid as boolean[];
  return { day: d.day, grid, score: gridScore(grid) };
}

/** This device's result for `day`, or null. Never throws. */
export function recallDailyResult(day: string): DailyResult | null {
  const result = parseDailyResult(readStored(DAILY_STORAGE_KEY));
  return result && result.day === day ? result : null;
}

/** Kept until the next day's replaces it. Never throws. */
export function rememberDailyResult(result: DailyResult): void {
  writeStored(DAILY_STORAGE_KEY, JSON.stringify({ day: result.day, grid: result.grid, score: result.score }));
}

// ── Counters: closed sets, every value a key tail ──────────────────────────

/**
 * `daily:<stage>`. `shown` is the card drawn startable on the setup page,
 * `repeat_view` the card drawn in its "done today" state — exclusive, once
 * per page load, so `shown` is the denominator for `started`. `started` is the
 * tap that stored a game; `finished` a daily Game Over after the reveal.
 */
export const DAILY_STAGES = ["shown", "started", "finished", "repeat_view"] as const;
export type DailyStage = (typeof DAILY_STAGES)[number];

export function isDailyStage(value: unknown): value is DailyStage {
  return typeof value === "string" && (DAILY_STAGES as readonly string[]).includes(value);
}

/** `daily_score:<n>`, on `finished` only. */
export const DAILY_SCORES = [0, 1, 2, 3, 4, 5] as const;
export type DailyScore = (typeof DAILY_SCORES)[number];

export function isDailyScore(value: unknown): value is DailyScore {
  return typeof value === "number" && (DAILY_SCORES as readonly number[]).includes(value);
}

/** `daily_share:<outcome>` — `shareLink`'s four outcomes, from either card. */
export const DAILY_SHARE_OUTCOMES = ["shared", "copied", "dismissed", "failed"] as const;
export type DailyShareOutcome = (typeof DAILY_SHARE_OUTCOMES)[number];

export function isDailyShareOutcome(value: unknown): value is DailyShareOutcome {
  return typeof value === "string" && (DAILY_SHARE_OUTCOMES as readonly string[]).includes(value);
}
