/**
 * The shape stored in sessionStorage and returned by `/api/playlist`.
 *
 * There is no `previewUrl` field, deliberately. Spotify stopped populating
 * `preview_url` in Nov 2024 and returns null for every track on Client
 * Credentials (measured 0/20 across four markets), so carrying it meant a
 * permanently-null column in sessionStorage, in the KV playlist cache and on
 * the wire, plus a branch in the game page that could never be taken. Clips are
 * resolved from iTunes/Deezer at play time — see lib/preview-cache.ts.
 *
 * `durationMs` is load-bearing for that resolution: it is the one signal that
 * survives a translated credit, and it is how a cover is told from the original.
 */
export interface Track {
  id: string;
  name: string;
  artists: string[];
  durationMs: number;
  albumName?: string;
  albumImageUrl?: string;
  rawJson?: Record<string, unknown>;
  createdAt: string;
  /** Mixed Playlist Mode: names of players whose playlist contained this track. */
  contributors?: string[];
  /** Spotify's 0-100 popularity score — used for the v2 "most mainstream" taste card award. */
  popularity?: number;
}
