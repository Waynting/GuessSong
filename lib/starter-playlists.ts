/**
 * Playlists to offer a host who has none to hand.
 *
 * ## The list is empty, and that is the shipped state
 *
 * This is the slot, not the contents. The site's owner adds public playlists
 * from their own Spotify account; until then `STARTER_PLAYLISTS` is `[]`,
 * `starterPlacement` returns null for every input, and the page renders
 * exactly what it rendered before this file existed. Do not fill it with ids
 * found elsewhere: a playlist somebody else owns can go private or be deleted
 * on any afternoon, and the first thing a new visitor is offered becomes a
 * refusal nobody here can fix.
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
 */

import { isPermanentRefusal } from "@/lib/playlist-help";

export interface StarterPlaylist {
  /** The playlist's Spotify id: 22 characters, and not one of Spotify's own. */
  id: string;
  /** What the chip says. */
  name: string;
  /** One short line on what is in it, shown under the name. */
  blurb: string;
}

/**
 * Ships empty — see the header. `tests/starter-playlists.test.ts` checks
 * whatever is added: every id 22 characters of base62, none beginning `37i9`
 * (Spotify's own, which no app can load), none listed twice, and a name and a
 * blurb on each.
 */
export const STARTER_PLAYLISTS: readonly StarterPlaylist[] = [];

export type StarterPlace = "field" | "refusal";

export interface StarterContext {
  /** Defaults to the real list; tests hand in a fixture. */
  starters?: readonly StarterPlaylist[];
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
 */
export function starterPlacement({
  starters = STARTER_PLAYLISTS,
  singleMode,
  fieldEmpty,
  recentCount,
  failureCode,
}: StarterContext): StarterPlace | null {
  if (starters.length === 0 || !singleMode) return null;
  if (isPermanentRefusal(failureCode)) return "refusal";
  if (fieldEmpty && recentCount === 0) return "field";
  return null;
}
