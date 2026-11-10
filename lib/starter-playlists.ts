/**
 * Playlists to offer a host who has none to hand.
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
}

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

export interface FieldChipRow<T extends { id: string }> {
  /** The one row under the field: the recent chips, then the starters not already among them. */
  playlists: ReadonlyArray<T | StarterPlaylist>;
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
 */
export function fieldChipRow<T extends { id: string }>(
  recent: readonly T[],
  starters: readonly StarterPlaylist[],
  place: StarterPlace | null
): FieldChipRow<T> {
  if (place !== "field") {
    return { playlists: recent, starterIds: new Set(), caption: null, label: "Recent" };
  }
  const recentIds = new Set(recent.map((r) => r.id));
  const added = starters.filter((s) => !recentIds.has(s.id));
  return {
    playlists: [...recent, ...added],
    starterIds: new Set(added.map((s) => s.id)),
    caption: recent.length === 0 ? starterCaption(starters.length) : null,
    label: recent.length === 0 ? "Starter playlists" : "Playlists",
  };
}
