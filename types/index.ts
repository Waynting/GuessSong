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
  /**
   * The album's release date as Spotify lists it: "1997", "1997-05" or
   * "1997-05-21", with the precision beside it. Read by `lib/order-game.ts`
   * at year level only. Optional twice over: Spotify omits it for some local
   * files, and every playlist cached before 1.20.1 lacks it — those entries
   * age out within a day (`lib/playlist-cache.ts`), which is why adding the
   * field did not bump the cache version. A track without one simply cannot
   * be dealt into an order round.
   */
  releaseDate?: string;
  releaseDatePrecision?: "year" | "month" | "day";
}
