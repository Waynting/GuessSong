/**
 * "Put them in order" — the party game that plays no audio.
 *
 * ## Why it exists
 *
 * Every round of the guess game is an upstream clip: a cold 50-song game is 50
 * lookups of up to five calls each against iTunes and Deezer, which throttle
 * the whole deployment as one noisy client (`lib/preview-cache.ts`). In the
 * week to 2026-10-09 only 56% of games ever pressed Play, and the leave pile
 * sat at rounds 1–2 — the rounds where "could not play" lives. This mode deals
 * four songs from the playlist as cards, the room puts them in order of
 * release year, the host reveals the real order and awards the points. No
 * clip is fetched, so it works in a loud bar, over a bad connection, and in
 * the minute iTunes is throttling us.
 *
 * ## The rules, and why they are here
 *
 * The page that plays it (`app/order/page.tsx`) is a client component vitest
 * cannot import, so every rule that decides a game is in this file:
 *
 * - **A year, never a date.** Spotify's `release_date_precision` is often
 *   `year`, and a room cannot reason about months from a title and a cover.
 *   `releaseYear` reads the first four characters and refuses anything before
 *   `ORDER_MIN_YEAR` or after next year — Spotify lists "0000" for some
 *   local files, and a 0 would sort as the oldest song ever made.
 * - **Every card in a round has a different year, so a round has no ties.**
 *   Two 2019 songs have no right order at year level, and a tiebreak the room
 *   cannot see is a point taken away for a reason nobody can explain.
 *   `buildOrderRounds` deals greedily and defers a same-year track to a later
 *   round — the `poolContributions` pattern in `lib/mixed-playlist.ts`.
 * - **A short last round is kept down to two cards.** Two songs is still a
 *   question ("which is older?"); one is not. A playlist whose songs share a
 *   year yields fewer rounds than songs, and the page says how many were left
 *   out rather than padding the game.
 * - **The host is the judge**, as in the guess game: `ORDER_EXACT_POINTS` to
 *   whoever called the whole order, `ORDER_OLDEST_POINTS` for the oldest song
 *   alone, one award of each per round. The reveal shows the real order; it
 *   does not grade anyone, because nobody typed anything.
 *
 * `releaseDate` reached `Track` one release before this mode (1.20.1) and the
 * playlist cache was not versioned for it, so a track without a date is an
 * ordinary thing to be handed and is simply not dealt — see `CACHE_VERSION`
 * in `lib/playlist-cache.ts`.
 */

import type { Track } from "@/types";

/**
 * How the setup page's "How to play" row is remembered and read back. Not a
 * `GameMode`: the stored payload's `mode` is `"order"` for this game and
 * `"party"` / `"buzzer"` for the other, and this is the control's own value.
 */
export type PlayStyle = "guess" | "order";

export const PLAY_STYLES: readonly PlayStyle[] = ["guess", "order"];

export const DEFAULT_PLAY_STYLE: PlayStyle = "guess";

/** Allow-list, not a cast — what comes out of storage was written by an older deploy. */
export function isPlayStyle(value: unknown): value is PlayStyle {
  return typeof value === "string" && (PLAY_STYLES as readonly string[]).includes(value);
}

/**
 * Cards per round. Four: three is a coin flip with an extra card, five does
 * not fit a phone with the picker under it. Fixed until `order_round:*`
 * says whether four is too easy.
 */
export const ORDER_ROUND_SIZE = 4;

/** The fewest cards a round is worth playing with. */
export const ORDER_MIN_ROUND_SIZE = 2;

export const ORDER_EXACT_POINTS = 3;
export const ORDER_OLDEST_POINTS = 1;

/** Earlier than any recording Spotify lists; "0000" is what it sends for an unknown date. */
export const ORDER_MIN_YEAR = 1900;

/**
 * The year a track's album came out, or null when there is no usable date.
 *
 * `now` is a parameter for the tests; a date later than next year is a
 * typo in somebody's catalogue, not a release.
 */
export function releaseYear(
  track: Pick<Track, "releaseDate">,
  now: Date = new Date()
): number | null {
  const date = track.releaseDate;
  if (typeof date !== "string") return null;
  const match = /^(\d{4})(?:-|$)/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < ORDER_MIN_YEAR || year > now.getUTCFullYear() + 1) return null;
  return year;
}

/**
 * The tracks that can be dealt at all, in the order given: a usable year,
 * and not from a compilation — "Greatest Hits 1970–2002" carries the
 * compilation's date, so the reveal would state the wrong year with
 * confidence and light a card green for it.
 */
export function usableOrderTracks<T extends Pick<Track, "releaseDate" | "albumCompilation">>(
  tracks: readonly T[]
): T[] {
  return tracks.filter((t) => t.albumCompilation !== true && releaseYear(t) !== null);
}

/**
 * True when most of the list carries no release date at all — more than half.
 *
 * Most, not every: a Mixed pool can mix a contributor whose playlist was
 * cached before the field existed with one loaded fresh, and blaming "the
 * playlists" for a gap in our cache is the mistake this exists to avoid.
 *
 * That is not a playlist with too few years: it is a playlist answered from
 * a cache entry written before 1.20.1 asked Spotify for the date (entries
 * live up to a day; a room's stored tracks, up to its TTL). Telling that host
 * their playlist has too few years would blame the playlist for our cache —
 * the throttled-host mistake again — so the setup page raises
 * `order_dates_pending` instead, which says to try again later.
 */
export function noReleaseDates(tracks: readonly Pick<Track, "releaseDate">[]): boolean {
  if (tracks.length === 0) return false;
  const dateless = tracks.filter((t) => typeof t.releaseDate !== "string").length;
  return dateless * 2 > tracks.length;
}

/**
 * The refusal for a list that deals no round, or null when it deals one.
 * One rule for the three start paths on the setup page.
 */
export function orderRefusal(
  tracks: readonly Pick<Track, "releaseDate" | "albumCompilation">[]
): "order_dates_pending" | "order_too_few_dated" | null {
  if (noReleaseDates(tracks)) return "order_dates_pending";
  return buildOrderRounds(usableOrderTracks(tracks)).rounds.length === 0
    ? "order_too_few_dated"
    : null;
}

/** One round: its cards, in the order the host's screen shows them. */
export interface OrderRound<T = Track> {
  tracks: T[];
}

/**
 * Deal `tracks` into rounds of `size` cards with distinct years, in the order
 * given — so the caller's shuffle is the only randomness, and a reload that
 * reads the same stored list deals the same game.
 *
 * Greedy with deferral: each pass takes the first track of every year it has
 * not seen until the round is full, and what it passed over starts the next
 * round. The passes get shorter as the years run out, so the short round, if
 * there is one, is the last. `leftover` is every track that was not dealt —
 * no date, or a year every remaining card already had — and the page prints
 * it, because a 20-song game that turns out to be three rounds should say so.
 */
export function buildOrderRounds<T extends Pick<Track, "releaseDate" | "albumCompilation">>(
  tracks: readonly T[],
  size: number = ORDER_ROUND_SIZE
): { rounds: OrderRound<T>[]; leftover: number } {
  const rounds: OrderRound<T>[] = [];
  let pool = usableOrderTracks(tracks);
  let leftover = tracks.length - pool.length;

  for (;;) {
    if (pool.length < ORDER_MIN_ROUND_SIZE) {
      leftover += pool.length;
      break;
    }
    const round: T[] = [];
    const years = new Set<number>();
    const rest: T[] = [];
    for (const track of pool) {
      const year = releaseYear(track) as number;
      if (round.length < size && !years.has(year)) {
        round.push(track);
        years.add(year);
      } else {
        rest.push(track);
      }
    }
    if (round.length < ORDER_MIN_ROUND_SIZE) {
      leftover += pool.length;
      break;
    }
    rounds.push({ tracks: round });
    pool = rest;
  }

  return { rounds, leftover };
}

/** The round's cards oldest first. Distinct by construction, so the sort is total. */
export function trueOrder<T extends Pick<Track, "releaseDate">>(round: OrderRound<T>): T[] {
  return [...round.tracks].sort((a, b) => (releaseYear(a) ?? 0) - (releaseYear(b) ?? 0));
}

/**
 * How a round came out, as the host scored it: `exact` is the whole order
 * called, `partial` is only the oldest song, `none` is nobody. Keyed
 * `order_round:<verdict>` in `lib/loop-stats.ts`; the distribution is the
 * difficulty gauge for `ORDER_ROUND_SIZE`.
 */
export type OrderVerdict = "exact" | "partial" | "none";

export const ORDER_VERDICTS: readonly OrderVerdict[] = ["exact", "partial", "none"];

export function isOrderVerdict(value: unknown): value is OrderVerdict {
  return typeof value === "string" && (ORDER_VERDICTS as readonly string[]).includes(value);
}

export function orderVerdict(awards: { exact: boolean; oldest: boolean }): OrderVerdict {
  if (awards.exact) return "exact";
  return awards.oldest ? "partial" : "none";
}

/**
 * Rounds played when the game ends — `countRoundsPlayed`'s arithmetic for
 * this page's phases. A round counts once it has been revealed; End Game
 * while the cards are still face down leaves the round unplayed.
 */
export function orderRoundsPlayed(currentIndex: number, phase: string): number {
  return currentIndex + (phase === "showing" ? 0 : 1);
}

/** How many full rounds a song count makes. */
export function orderRoundCount(songCount: number, size: number = ORDER_ROUND_SIZE): number {
  return Math.floor(songCount / size);
}

/** The settings line's reading of the song count in this mode. */
export function orderSummary(songCount: number | "all"): string {
  if (songCount === "all") return `All songs, ${ORDER_ROUND_SIZE} a round`;
  const rounds = orderRoundCount(songCount);
  return `${songCount} songs (${rounds} round${rounds === 1 ? "" : "s"} of ${ORDER_ROUND_SIZE})`;
}

/** The note under the cards for the songs that could not be dealt, or null for none. */
export function orderLeftoverLine(leftover: number): string | null {
  if (!Number.isInteger(leftover) || leftover <= 0) return null;
  return leftover === 1
    ? "1 song left out — no release year, or the same year as every other card"
    : `${leftover} songs left out — no release year, or the same year as every other card`;
}
