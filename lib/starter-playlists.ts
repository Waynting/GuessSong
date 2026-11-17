/**
 * Playlists to offer a host who has none to hand.
 *
 * ## Adding a theme pack — one entry, once the owner has an id
 *
 * 1. The owner makes the playlist **public on their own Spotify account**
 *    (never somebody else's, never a `37i9…` one) and sends its link.
 * 2. Add its key to `STARTER_KEYS` below. The key and the entry go in
 *    together: a key with no entry is a counter that can never move, and
 *    `tests/starter-playlists.test.ts` refuses either half on its own. Add
 *    the key to `STARTER_KEY_ORDER` in `scripts/loop-stats.mjs` too, so it
 *    prints in a fixed place (it still prints, last, if forgotten).
 * 3. Add one entry to `STARTER_PLAYLISTS`:
 *
 *        {
 *          id: "<the 22 characters after /playlist/ in the link>",
 *          starterKey: "eighties",
 *          game: "order",            // or "guess": the style it is offered in
 *          name: "Hits of the 80s",
 *          blurb: "Synths, big hair, every chorus you know.",
 *          theme: { label: "80s", emoji: "📼", markets: ["US", "GB"] },
 *        },
 *
 *    `theme.label` is the chip's whole text in the theme row (at most
 *    `THEME_LABEL_MAX` characters); `emoji` is optional; `markets` is
 *    optional too — ISO 3166 country codes whose visitors see the chip
 *    first. It only orders the row: no visitor is shown fewer themes for
 *    where they are.
 *
 * That is all. Once a style has `THEME_ROW_MIN` (two) starters carrying a
 * `theme`, the setup page offers that style's starters as a "Pick a theme"
 * row (`themeRowFor`) instead of the name-and-blurb chips, ordered by the
 * device's region, and reports one `starter_theme_row:shown:<style>` per page
 * that drew it. Below two themed entries the page renders exactly what it did
 * before themes existed, `theme` field or not. The pick is counted as it
 * always was, `host_setup_starter:<key>`. `docs/operations.md` §6 has the
 * same steps.
 *
 * ## Whose playlists these should be
 *
 * The site owner's own public playlists, by default. With `STARTER_PLAYLISTS`
 * empty, `starterPlacement` returns null for every input and the page renders
 * exactly what it rendered before this file existed. A playlist somebody else
 * owns can go private or be deleted on any afternoon, and the first thing a
 * new visitor is offered becomes a refusal nobody here can fix.
 *
 * ## This is not the built-in mode that was removed
 *
 * 1.5.0 deleted a trial mode that shipped 48 tracks inside the browser bundle
 * and ended in a single-player scoreboard, because GuessSong is a game for a
 * room full of people. Nothing here brings that back. A starter is an ordinary
 * playlist link: tapping one puts it in the field, Start sends it through
 * `POST /api/playlist` like any other, and what starts is a normal party game
 * with the players the host typed. The only thing special about it is that,
 * being offered to everyone, it stays warm in `lib/playlist-cache.ts` — which
 * makes it the cheapest playlist on the site to load, not a special case in
 * the code.
 *
 * ## Where they are offered
 *
 * Two places, both of them a host with no way forward:
 *
 *   - under the error box, when the link was refused for good;
 *   - under the field, when it is empty and the device has no recent
 *     playlists to offer instead.
 *
 * Never both at once. Under the field they give way to the recent chips: a
 * returning host has playlists of their own, and those are the better offer.
 *
 * ## Except in the order game, where the starter is for the returning host
 *
 * Since 2026-11-10 each starter names the game it is for (`game`), and the
 * order style offers its own list — "Hits from every decade" — *beside* the
 * recent chips, filled field or not. The host it is for has a filled field:
 * `restored` was the largest source of order games over before their first
 * reveal (~145/day), because a returning solo host's remembered list is
 * often the one that is not orderable (a 2010s party list), and the two
 * guess-game starters landing in the order game were ~130/day of the same
 * bounce. `host_setup_starter:<starterKey>` counts which list was played, by
 * any route — a recent chip or a restored link whose id is one of ours is
 * still our list being played.
 */

import { isPermanentRefusal } from "@/lib/playlist-help";
import { playableRefOf, playlistUrlOf } from "@/lib/playlist-ref";
import type { PlayStyle } from "@/lib/order-game";

/**
 * The closed set the counter is keyed by: `host_setup_starter:<key>` in
 * lib/loop-stats.ts, `starter` on the `game_started` pulse, `starter_key` in
 * GA4. A key, never the playlist id, so a replaced list keeps its series.
 */
export const STARTER_KEYS = ["party_hits", "reggaeton", "decades"] as const;

export type StarterKey = (typeof STARTER_KEYS)[number];

export function isStarterKey(value: unknown): value is StarterKey {
  return typeof value === "string" && (STARTER_KEYS as readonly string[]).includes(value);
}

export interface StarterPlaylist {
  /** The playlist's Spotify id: 22 characters, and not one of Spotify's own. */
  id: string;
  /** The counter's name for it. One per entry, from `STARTER_KEYS`. */
  starterKey: StarterKey;
  /** The game it is for: offered in that play style only. */
  game: PlayStyle;
  /** What the chip says. */
  name: string;
  /** One short line on what is in it, shown under the name. */
  blurb: string;
  /**
   * How it is drawn in a "Pick a theme" row, once its style has
   * `THEME_ROW_MIN` themed starters (`themeRowFor`). Ignored below that.
   */
  theme?: StarterTheme;
}

export interface StarterTheme {
  /** The chip's text in the theme row: short, `THEME_LABEL_MAX` characters at most. */
  label: string;
  /** One emoji before the label, or none. */
  emoji?: string;
  /**
   * ISO 3166-1 alpha-2 codes, upper case, whose visitors see this chip first.
   * Ordering only, never a filter: every visitor is offered every theme.
   */
  markets?: readonly string[];
}

/** Longer than this and a chip stops reading as a theme. */
export const THEME_LABEL_MAX = 20;

/** How many themed starters a style needs before it gets a theme row. */
export const THEME_ROW_MIN = 2;

/** The sentence over a row of themes alone. */
export const THEME_CAPTION = "Pick a theme";

/**
 * `tests/starter-playlists.test.ts` checks whatever is here: every id 22
 * characters of base62, none beginning `37i9` (Spotify's own, which no app
 * can load), none listed twice, and a name and a blurb on each.
 *
 * ## Both are copies on the site owner's account (2026-10-03)
 *
 * From 1.18.0 to here they were two third-party playlists, by the owner's
 * choice, and one had already been renamed by its owner. These are copies of
 * the same tracks under the owner's account (titled "… _Guessong" on
 * Spotify; the chip's name is ours). Replace them only with playlists the
 * owner holds, and if `playlist_refused:playlist_not_found` jumps after a
 * deploy, check these first.
 */
export const STARTER_PLAYLISTS: readonly StarterPlaylist[] = [
  {
    id: "28f48HyPfD0fPEGuCBD0kr",
    starterKey: "party_hits",
    game: "guess",
    name: "Party Hits 2010–2026",
    blurb: "The songs everyone knows from the last fifteen years.",
  },
  {
    id: "2RkIQaN5IwRPUaFu2TZklb",
    starterKey: "reggaeton",
    game: "guess",
    name: "Reggaetón Viejo",
    blurb: "Old-school reggaetón: Don Omar, Wisin & Yandel, Arcángel.",
  },
  // The order game's own list (2026-11-10): 375 songs, every one dated,
  // 62 distinct years from 1961 to 2026, so the deal keeps its year gap all
  // the way down. The owner's; its Spotify name is "EN", the chip's is ours.
  {
    id: "0RRc1JAhWKFm7QSWGiI5y8",
    starterKey: "decades",
    game: "order",
    name: "Hits from every decade",
    blurb: "Songs everyone knows, 1960s to now.",
  },
];

/** The starters for one play style — the only ones that style ever offers. */
export function startersFor(
  playStyle: PlayStyle,
  starters: readonly StarterPlaylist[] = STARTER_PLAYLISTS
): StarterPlaylist[] {
  return starters.filter((s) => s.game === playStyle);
}

/**
 * The counter's name for the playlist in the field, or null when it is not
 * one of ours. `ref` is a playable ref (`playableRefOf`, lib/playlist-ref.ts)
 * and so is each starter's, built from its id the same way, so an album
 * starter one day compares `album:<id>` against `album:<id>` and not an id
 * against a ref. Derived at the start, from the field, whatever route put
 * the link there: that is the counter's definition.
 */
export function starterKeyForId(
  ref: string | null,
  starters: readonly StarterPlaylist[] = STARTER_PLAYLISTS
): StarterKey | null {
  if (ref === null) return null;
  const match = starters.find((s) => playableRefOf(playlistUrlOf(s.id)) === ref);
  return match ? match.starterKey : null;
}

export type StarterPlace = "field" | "refusal";

export interface StarterContext {
  /** Defaults to the real list; tests hand in a fixture. Pass `startersFor(playStyle)`. */
  starters?: readonly StarterPlaylist[];
  /** Which game the form is set to; the order style has its own placement rule. */
  playStyle: PlayStyle;
  /** The form is on Single Playlist — the only mode with a field to fill. */
  singleMode: boolean;
  /** Nothing in the playlist field but whitespace. */
  fieldEmpty: boolean;
  /** How many recent-playlist chips the device has. */
  recentCount: number;
  /** The code of the error on screen, or null when there is none. */
  failureCode: string | null;
}

/**
 * Where the starters go, or null for "nowhere".
 *
 * The refusal outranks the empty field. A host can clear the field while the
 * error box is still up, which makes both conditions true at once, and the
 * box is the one they are reading. `isPermanentRefusal` is the same predicate
 * that decides whether the box carries help, so the two cannot disagree about
 * which refusals are the link's fault: a throttled host is never offered
 * "try one of these" as though theirs had been the problem.
 *
 * The order style departs from the "never beside a filled field" rule, for
 * that style only: its starter is offered whenever the form is on a single
 * playlist and no refusal is up, filled field or not, recent chips or not,
 * because the host it is for has a filled field (see the header). It is also
 * the answer to `order_too_few_dated` — "pick one that spans a few years",
 * and this is the list that does — so that refusal puts it under the box;
 * `order_dates_pending` stays out, because it clears by itself and a swap
 * would blame the list for our cache.
 */
export function starterPlacement({
  starters = STARTER_PLAYLISTS,
  playStyle,
  singleMode,
  fieldEmpty,
  recentCount,
  failureCode,
}: StarterContext): StarterPlace | null {
  if (starters.length === 0 || !singleMode) return null;
  if (isPermanentRefusal(failureCode)) return "refusal";
  if (playStyle === "order") {
    return failureCode === "order_too_few_dated" ? "refusal" : "field";
  }
  if (fieldEmpty && recentCount === 0) return "field";
  return null;
}

/** The sentence over a row of starters alone: one pill under "try one of these" reads as a fragment. */
export function starterCaption(count: number): string {
  return count === 1 ? "No playlist handy? Start with ours" : "No playlist handy? Try one of these";
}

export interface FieldChipRow<T extends { id: string }, S extends { id: string } = StarterPlaylist> {
  /** The one row under the field: the recent chips, then the starters not already among them. */
  playlists: ReadonlyArray<T | S>;
  /** Which of those are starters — what `onPick` names the source by. */
  starterIds: ReadonlySet<string>;
  /** Only over a row of starters alone; recents need no sentence. */
  caption: string | null;
  /** The row's name for a screen reader, and its head when there is no caption. */
  label: string;
}

/**
 * What the row under the field holds. One `PlaylistChips`, never two: two
 * instances are two rows, and the order starter beside a filled field is
 * the whole point. Deduped on id with the recent entry winning — a host who
 * played the decades list last night sees one chip, not two — and the
 * starters' ids handed back so the pick can say which it was. With `place`
 * anything but `field` the row is the recent chips exactly as before.
 *
 * Handed a theme row (`themeRowFor`) in place of the starters, with
 * `themed`, the same rules hold — one row, recents first, deduped on id —
 * and only the words change: "Pick a theme" over a row of themes alone.
 * Beside recent chips the themes are still in the one row, never a second:
 * Start has to stay on a 390×844 screen.
 */
export function fieldChipRow<T extends { id: string }, S extends { id: string } = StarterPlaylist>(
  recent: readonly T[],
  starters: readonly S[],
  place: StarterPlace | null,
  { themed = false }: { themed?: boolean } = {}
): FieldChipRow<T, S> {
  if (place !== "field") {
    return { playlists: recent, starterIds: new Set(), caption: null, label: "Recent" };
  }
  const recentIds = new Set(recent.map((r) => r.id));
  const added = starters.filter((s) => !recentIds.has(s.id));
  return {
    playlists: [...recent, ...added],
    starterIds: new Set(added.map((s) => s.id)),
    caption: recent.length === 0 ? (themed ? THEME_CAPTION : starterCaption(starters.length)) : null,
    label: recent.length === 0 ? (themed ? "Themes" : "Starter playlists") : "Playlists",
  };
}

/** One chip in a theme row: what `PlaylistChips` draws, and the key it came from. */
export interface ThemeChip {
  id: string;
  /** The emoji and the label, as the chip shows them. */
  name: string;
  starterKey: StarterKey;
}

/**
 * The device's region from `navigator.languages`: "pt-BR" is `BR`,
 * "zh-Hant-TW" is `TW`, a bare "en" is nothing. The first tag naming a region
 * wins. Read in an effect on the setup page, never in a `useState`
 * initialiser — `/` is prerendered, and reading the request's country
 * (`lib/market.ts`) there would make it dynamic.
 */
export function regionFromLanguages(languages: readonly unknown[] | null | undefined): string | null {
  for (const tag of languages ?? []) {
    if (typeof tag !== "string") continue;
    const match = /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(tag.trim());
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/**
 * The starters in market order: those whose `theme.markets` names `region`
 * first, then the rest, each half in the list's own order. Never drops an
 * entry — the hint orders, it does not hide.
 */
export function orderByMarket<S extends Pick<StarterPlaylist, "theme">>(
  starters: readonly S[],
  region: string | null
): S[] {
  const want = region ? region.toUpperCase() : null;
  const matches = (s: S) => want !== null && (s.theme?.markets ?? []).includes(want);
  return [...starters.filter(matches), ...starters.filter((s) => !matches(s))];
}

/**
 * The theme row for one style's starters (pass `startersFor(playStyle)`), or
 * null for "draw them as before".
 *
 * Null until `THEME_ROW_MIN` of them carry a `theme`, so a style with one
 * starter — the order game's, today — or with untitled ones renders exactly
 * what it rendered before themes existed. Once it is on, every starter of the
 * style is in it (one without a theme under its name), in market order.
 */
export function themeRowFor(
  starters: readonly StarterPlaylist[],
  region: string | null
): ThemeChip[] | null {
  if (starters.filter((s) => s.theme).length < THEME_ROW_MIN) return null;
  return orderByMarket(starters, region).map((s) => ({
    id: s.id,
    name: s.theme ? (s.theme.emoji ? `${s.theme.emoji} ${s.theme.label}` : s.theme.label) : s.name,
    starterKey: s.starterKey,
  }));
}
