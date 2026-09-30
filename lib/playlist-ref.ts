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
const PLAYLIST_PATTERNS = [/playlist\/([a-zA-Z0-9]+)/, /spotify:playlist:([a-zA-Z0-9]+)/];

/** What Spotify's own ids look like: 22 characters of base62. */
const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;

/**
 * How every id Spotify mints for its own playlists begins — Today's Top Hits,
 * Discover Weekly, every "This Is". Mirrors `isSpotifyEditorial`.
 */
export const EDITORIAL_ID_PREFIX = "37i9";

/** The id the server would read out of this text, or null when it would read none. */
export function playlistIdOf(text: string): string | null {
  for (const pattern of PLAYLIST_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * True for a string that could be a real playlist id. Stricter than
 * `playlistIdOf` on purpose: that one predicts what the server will parse, this
 * one decides what is fit to be *stored* and turned back into an address, and
 * a playlist that actually loaded always has an id of this shape.
 */
export function isPlaylistId(value: unknown): value is string {
  return typeof value === "string" && PLAYLIST_ID.test(value);
}

export function isEditorialId(id: string): boolean {
  return id.startsWith(EDITORIAL_ID_PREFIX);
}

/**
 * Whether this link names one of Spotify's own playlists.
 *
 * The check it replaces was `playlistUrl.includes("37i9")`, which asked
 * whether those four characters appear *anywhere* — in the middle of an id, in
 * the `?si=` token, in whatever text was pasted around the link. That was
 * tolerable under a warning that said "may not work". The warning now says
 * these cannot be loaded, which is only true of the links the server refuses,
 * so it has to ask the server's question: does the *id* begin with it. A loose
 * match under a definite sentence is a host told their own playlist is
 * Spotify's, above a Start button that would have worked.
 */
export function isEditorialLink(text: string): boolean {
  const id = playlistIdOf(text);
  return id !== null && isEditorialId(id);
}

/**
 * The one address a playlist is stored and offered under.
 *
 * What a host pastes carries `?si=…`, which is Spotify's share-tracking token
 * and belongs to whoever pressed Share. Keeping the pasted string would keep
 * that token in this browser's storage for no benefit; the id is the playlist.
 */
export function playlistUrlOf(id: string): string {
  return `https://open.spotify.com/playlist/${id}`;
}
