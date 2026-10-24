/**
 * What the browser can know about a playlist link without asking anybody.
 *
 * Three things on the setup page need a playlist *id* rather than a string
 * that happens to contain one: the editorial warning, which is a claim about
 * how the id begins; the recent-playlist chips, which are deduplicated by it;
 * and the remembered setup, which stores the canonical address rather than
 * whatever was pasted. None of them may import `lib/spotify.ts` to get it —
 * that module is server code, and pulling it into the setup page would put the
 * Spotify client in the browser bundle (the reason `lib/song-count.ts` copies
 * `MAX_SONG_COUNT` instead of importing it).
 *
 * So this is a second spelling of `parsePlaylistUrl`, and a second spelling of
 * a rule is the thing this codebase keeps getting bitten by. What holds the two
 * together is `tests/playlist-ref.test.ts`, which runs both over the same
 * links and fails when they disagree about any of them.
 */

/**
 * The same two patterns, in the same order, as `parsePlaylistUrl` in
 * `lib/spotify.ts`. Deliberately as loose as the server's — any run of
 * alphanumerics, not exactly 22 — because the editorial warning has to agree
 * with the refusal it predicts: the server refuses whatever *it* parses as
 * beginning `37i9`, and a stricter reading here would stay quiet about a link
 * the host is about to be refused for.
 */
import {
  albumUrlFromId,
  isEditorialPlaylistId,
  isEditorialPlaylistLink,
  playableLinkFrom,
  playlistIdFromLink,
  playlistUrlFromId,
} from "@/lib/spotify-link";

// Names for `lib/spotify-link.ts`, not a second parser. This file was
// written beside the classifier rather than on top of it, and a copy of the
// old unanchored regexes here would be a link the green check accepts and the
// server refuses — the disagreement that module exists to end.

const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;

export const EDITORIAL_ID_PREFIX = "37i9";

export function playlistIdOf(text: string): string | null {
  return playlistIdFromLink(text);
}

export function isPlaylistId(value: unknown): value is string {
  return typeof value === "string" && PLAYLIST_ID.test(value);
}

export function isEditorialId(id: string): boolean {
  return isEditorialPlaylistId(id);
}

export function isEditorialLink(text: string): boolean {
  return isEditorialPlaylistLink(text);
}

export function playlistUrlOf(id: string): string {
  return playlistUrlFromId(id);
}

/**
 * A playlist or an album as one storable string — the *ref* the setup
 * memory and the recent chips key on (`lib/setup-memory.ts`).
 *
 * A playlist's ref is its bare 22-character id, byte for byte what the two
 * storage keys held before albums could load, so nothing a host's browser
 * already remembers reads differently. An album's is `album:<id>`: the colon
 * cannot occur in an id, so the two cannot collide, and `isEditorialId` is
 * false for every album ref by construction — `37i9` is a playlist-id
 * convention and the prefix is in front of it.
 */
const ALBUM_REF_PREFIX = "album:";

export function playableRefOf(text: string): string | null {
  const link = playableLinkFrom(text);
  if (!link) return null;
  return link.kind === "album" ? `${ALBUM_REF_PREFIX}${link.id}` : link.id;
}

export function isPlayableRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return value.startsWith(ALBUM_REF_PREFIX)
    ? PLAYLIST_ID.test(value.slice(ALBUM_REF_PREFIX.length))
    : PLAYLIST_ID.test(value);
}

/** The canonical address a ref names — the inverse of `playableRefOf`. */
export function playableUrlOf(ref: string): string {
  return ref.startsWith(ALBUM_REF_PREFIX)
    ? albumUrlFromId(ref.slice(ALBUM_REF_PREFIX.length))
    : playlistUrlFromId(ref);
}
