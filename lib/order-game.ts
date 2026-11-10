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
 * - **The deal prefers a gap between the years, when the list allows it.**
 *   41.1% of revealed rounds in the ten days to 2026-11-10 scored nobody, and
 *   70% of the rounds left as dealt did: 2019 against 2021 against 2022 is
 *   not a question a stranger to the playlist can answer. So the deal first
 *   tries rounds whose years are pairwise `ORDER_PREFERRED_YEAR_GAP` apart,
 *   then one less, down to merely distinct — and takes the widest gap whose
 *   whole deal gives up nothing: as many rounds, as many full rounds and as
 *   many cards as the distinct-years deal. A playlist of consecutive years
 *   deals exactly as it did before.
 * - **A short last round is kept down to two cards.** Two songs is still a
 *   question ("which is older?"); one is not. A playlist whose songs share a
 *   year yields fewer rounds than songs, and the page says how many were left
 *   out rather than padding the game.
 * - **The host is the judge**, as in the guess game: `ORDER_EXACT_POINTS` to
 *   whoever called the whole order, `ORDER_OLDEST_POINTS` for the oldest song
 *   alone, one award of each per round. The reveal shows the real order; it
 *   does not grade anyone, because nobody typed anything. With a buzzer room
 *   every phone arranges its own copy and is graded instead, every scorer
 *   scoring — `lib/order-phone.ts`.
 *
 * `releaseDate` reached `Track` one release before this mode (1.20.1) and the
 * playlist cache was not versioned for it, so a track without a date is an
 * ordinary thing to be handed and is simply not dealt — see `CACHE_VERSION`
 * in `lib/playlist-cache.ts`.
 */

import type { Track } from "@/types";
import type { OrderPhoneVerdict } from "@/lib/buzzer-protocol";

export type { OrderPhoneVerdict };

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
 * What the setup page says this game is — on the "Just me" tile and on the
 * "Game" pill inside the settings fold, so the game is described once. The
 * silence is said as a benefit: a desk or a commute is where a solo Google
 * looker is, and 82% of order games over before their first reveal had moved
 * nothing — a tile that read as "a music game" had promised a clip.
 */
export const ORDER_BLURB = "Four songs, oldest to newest. No sound — it scores itself.";

/**
 * Whether the first-round drag cue runs: round zero, nothing moved yet, and
 * this screen is the one that arranges. On the host's page `phones` is a
 * buzzer room in play (the phones arrange there), and `moved` is
 * `hostArranged`; on a phone `phones` is false — the phone *is* the player —
 * and `moved` is its own local arrangement or lock. The cue is the last card
 * lifting toward the top, twice (`.beckon` in app/globals.css): the gesture
 * asked for, on the card whose move gives nothing away.
 */
export function showDragCue({ round, moved, phones }: { round: number; moved: boolean; phones: boolean }): boolean {
  return round === 0 && !moved && !phones;
}

/**
 * Cards per round. Four: three is a coin flip with an extra card, five does
 * not fit a phone with the picker under it. Fixed until `order_round:*`
 * says whether four is too easy.
 */
export const ORDER_ROUND_SIZE = 4;

/** The fewest cards a round is worth playing with. */
export const ORDER_MIN_ROUND_SIZE = 2;

/**
 * How far apart, in years, the deal tries to keep the cards of one round
 * before it settles for less. Three: a decade is too much to ask of a 2010s
 * playlist, two is 2019 against 2021 — the pairs that score nobody. The knob
 * `buildOrderRounds` ladders down from; `order_round:<verdict>` is what says
 * whether it is right (above ~60% full order it comes down).
 */
export const ORDER_PREFERRED_YEAR_GAP = 3;

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
 * One deal of an already-usable pool: rounds of up to `size` cards whose
 * years are pairwise at least `minGap` apart, in the order given. `minGap`
 * of 1 is "distinct years" — the deal as it was before 2026-11-10.
 *
 * Greedy with deferral: each pass takes the first track whose year is far
 * enough from every year already in the round until the round is full, and
 * what it passed over starts the next round. The passes get shorter as the
 * years run out, so the short round, if there is one, is the last.
 * `stranded` is every track the gap left undealt.
 */
function dealRounds<T extends Pick<Track, "releaseDate">>(
  usable: readonly T[],
  size: number,
  minGap: number
): { rounds: OrderRound<T>[]; stranded: number } {
  const rounds: OrderRound<T>[] = [];
  let pool: readonly T[] = usable;
  let stranded = 0;

  for (;;) {
    if (pool.length < ORDER_MIN_ROUND_SIZE) {
      stranded += pool.length;
      break;
    }
    const round: T[] = [];
    const years: number[] = [];
    const rest: T[] = [];
    for (const track of pool) {
      const year = releaseYear(track) as number;
      if (round.length < size && years.every((y) => Math.abs(y - year) >= minGap)) {
        round.push(track);
        years.push(year);
      } else {
        rest.push(track);
      }
    }
    if (round.length < ORDER_MIN_ROUND_SIZE) {
      stranded += pool.length;
      break;
    }
    rounds.push({ tracks: round });
    pool = rest;
  }

  return { rounds, stranded };
}

/** What a deal is measured by, when two are compared: rounds, full rounds, cards dealt. */
function dealSize(deal: { rounds: OrderRound<unknown>[] }, size: number): [number, number, number] {
  const cards = deal.rounds.reduce((n, r) => n + r.tracks.length, 0);
  const full = deal.rounds.filter((r) => r.tracks.length >= size).length;
  return [deal.rounds.length, full, cards];
}

/**
 * Deal `tracks` into rounds of `size` cards, in the order given — so the
 * caller's shuffle is the only randomness, and a reload that reads the same
 * stored list deals the same game.
 *
 * The deal prefers a gap between the years: it tries `preferredGap`, then one
 * less, down to 1 (distinct years, the deal before 2026-11-10), and takes the
 * **first whole deal that gives up nothing** against the distinct-years deal —
 * at least as many rounds, at least as many full rounds, at least as many
 * cards. A whole-deal ladder, not a per-round one: gap 3 for this round and
 * gap 2 for the next would deal a different game on a mixed list and make
 * the `order_round` read ambiguous. The full-round count is in the comparison
 * because a wider gap can deal *more* rounds of *fewer* cards — seven
 * consecutive years ladder into rounds of three at gap 3 — and
 * `ORDER_ROUND_SIZE` is a decision, not a ceiling to be eaten by a gap.
 *
 * `leftover` is every track that was not dealt — no date, a compilation, or
 * a year too close to every other remaining card — and the page prints it,
 * because a 20-song game that turns out to be three rounds should say so. A
 * gapped deal never raises it: it is taken only when it deals at least as
 * many cards.
 */
export function buildOrderRounds<T extends Pick<Track, "releaseDate" | "albumCompilation">>(
  tracks: readonly T[],
  size: number = ORDER_ROUND_SIZE,
  preferredGap: number = ORDER_PREFERRED_YEAR_GAP
): { rounds: OrderRound<T>[]; leftover: number } {
  const usable = usableOrderTracks(tracks);
  const undealable = tracks.length - usable.length;
  const base = dealRounds(usable, size, 1);
  const floor = dealSize(base, size);
  const top = Number.isFinite(preferredGap) ? Math.trunc(preferredGap) : 1;

  for (let gap = top; gap > 1; gap--) {
    const gapped = dealRounds(usable, size, gap);
    const measure = dealSize(gapped, size);
    if (measure.every((n, i) => n >= floor[i])) {
      return { rounds: gapped.rounds, leftover: undealable + gapped.stranded };
    }
  }
  return { rounds: base.rounds, leftover: undealable + base.stranded };
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
    ? "1 song left out — no release year, or too close in year to every other card"
    : `${leftover} songs left out — no release year, or too close in year to every other card`;
}

/**
 * The cards as the room has arranged them, by id. Starts as the deal and is
 * what a drag or an arrow key changes; the reveal is read against it.
 *
 * The arrangement exists because the host's screen was a picture of four
 * cards and nothing more — the room argued, the host judged who had called
 * it, and 69% of revealed rounds on 2026-10-11 came back "nobody". A one
 * player game, which is most games, had no one to argue with and no way to
 * say what they thought. Dragging puts the answer on the screen, and the
 * reveal can then mark it card by card.
 */
export function moveCard(ids: readonly string[], from: number, to: number): string[] {
  const out = [...ids];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(to, out.length - 1));
  const [moved] = out.splice(from, 1);
  out.splice(target, 0, moved);
  return out;
}

/**
 * Where a dragged card lands: the slot whose centre is nearest the card's
 * centre. `centres` are the slots' vertical centres at the start of the
 * drag, top to bottom.
 */
export function dropSlot(centre: number, centres: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < centres.length; i++) {
    if (Math.abs(centres[i] - centre) < Math.abs(centres[best] - centre)) best = i;
  }
  return best;
}

/** How an arrangement reads against the real order. */
export interface ArrangementResult {
  /** Cards sitting in their true slot. */
  inPlace: number;
  /** Every card in its true slot — the round's full answer. */
  exact: boolean;
  /** The oldest card first — the consolation answer. */
  oldest: boolean;
}

export function readArrangement<T extends Pick<Track, "id" | "releaseDate">>(
  arranged: readonly string[],
  round: OrderRound<T>
): ArrangementResult {
  const truth = trueOrder(round).map((t) => t.id);
  const inPlace = truth.filter((id, i) => arranged[i] === id).length;
  return {
    inPlace,
    exact: truth.length > 0 && inPlace === truth.length,
    oldest: truth.length > 0 && arranged[0] === truth[0],
  };
}

/**
 * How many of the phones in a per-phone round had locked in when the years
 * went up: `order_phone:<all|some|none>`, once per revealed round. The
 * question it answers is whether a room finds the Lock in button at all;
 * `lib/order-phone.ts` decides which seats count as phones.
 */
export type OrderPhoneCoverage = "all" | "some" | "none";

export const ORDER_PHONE_COVERAGES: readonly OrderPhoneCoverage[] = ["all", "some", "none"];

export function isOrderPhoneCoverage(value: unknown): value is OrderPhoneCoverage {
  return typeof value === "string" && (ORDER_PHONE_COVERAGES as readonly string[]).includes(value);
}

/**
 * One locked arrangement's grade: `order_phone_verdict:<exact|oldest|none>`.
 * The type is the wire's (lib/buzzer-protocol.ts); the list is here, beside
 * the counters' other closed sets.
 */
export const ORDER_PHONE_VERDICTS: readonly OrderPhoneVerdict[] = ["exact", "oldest", "none"];

export function isOrderPhoneVerdict(value: unknown): value is OrderPhoneVerdict {
  return typeof value === "string" && (ORDER_PHONE_VERDICTS as readonly string[]).includes(value);
}

/** The host's arrangement of one round, as the order page holds it in state. */
export interface HostArrangement {
  round: number;
  ids: string[];
  moved: boolean;
}

/**
 * Whether the host moved a card in `round` on this screen: the arrangement
 * the drag wrote belongs to that round and was moved. The one predicate
 * behind `order_arranged` (a revealed round), `order_bounce` (a game over
 * before any reveal, from both beacons) and the reveal's own reading. Here
 * rather than in the page so the suite can reach it; `null` is a round
 * nobody has touched.
 */
export function hostArranged(arrangement: HostArrangement | null, round: number): boolean {
  return arrangement !== null && arrangement.round === round && arrangement.moved;
}
