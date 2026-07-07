/**
 * Parsing for the Web Share Target endpoint (/share).
 *
 * Android's share intent puts the Spotify link in `text` (EXTRA_TEXT) more
 * often than `url`, usually with prefix text around it, so the route handler
 * concatenates all three params and we scan the blob here.
 */

const PLAYLIST_RE =
  /open\.spotify\.com\/(?:intl-[\w-]+\/)?playlist\/([A-Za-z0-9]{22})/;
const ALBUM_RE = /open\.spotify\.com\/(?:intl-[\w-]+\/)?album\/[A-Za-z0-9]{22}/;
const TRACK_RE = /open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/[A-Za-z0-9]{22}/;
const ARTIST_RE =
  /open\.spotify\.com\/(?:intl-[\w-]+\/)?artist\/[A-Za-z0-9]{22}/;
const SHORTLINK_RE = /https?:\/\/spotify\.link\/[\w-]+/;

export type SharedLink =
  | { kind: "playlist"; id: string }
  | { kind: "shortlink"; url: string }
  | { kind: "track" }
  | { kind: "album" }
  | { kind: "artist" }
  | { kind: "unknown" };

/** Classify shared text without any network I/O. */
export function parseSharedText(raw: string): SharedLink {
  const playlist = raw.match(PLAYLIST_RE);
  if (playlist) return { kind: "playlist", id: playlist[1] };

  const shortlink = raw.match(SHORTLINK_RE);
  if (shortlink) return { kind: "shortlink", url: shortlink[0] };

  if (TRACK_RE.test(raw)) return { kind: "track" };
  if (ALBUM_RE.test(raw)) return { kind: "album" };
  if (ARTIST_RE.test(raw)) return { kind: "artist" };
  return { kind: "unknown" };
}

/**
 * Resolve a spotify.link shortlink by following redirects server-side
 * (the client can't — CORS), then re-classify the final URL.
 */
export async function resolveShortlink(url: string): Promise<SharedLink> {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok && res.status !== 405) {
      res = await fetch(url, { redirect: "follow" });
    }
    const parsed = parseSharedText(res.url);
    // Don't loop on shortlink → shortlink.
    return parsed.kind === "shortlink" ? { kind: "unknown" } : parsed;
  } catch {
    return { kind: "unknown" };
  }
}

export function playlistUrlFromId(id: string): string {
  return `https://open.spotify.com/playlist/${id}`;
}
