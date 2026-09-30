import { NextRequest, NextResponse } from "next/server";
import { loadPlaylist } from "@/lib/playlist-cache";
import { SpotifyApiError } from "@/lib/spotify";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";

// Still the most expensive route we have, but no longer unbounded: loads go
// through lib/playlist-cache.ts, so a repeat of the same playlist costs zero
// upstream calls and a cold one is capped at MAX_PLAYLIST_TRACKS.
//
// Note this limit is per IP while Spotify's quota is per app — it bounds one
// abusive client, not the site. The cache and the cooldown in playlist-cache
// are what bound the aggregate.
const PLAYLIST_LIMIT = 30;
const PLAYLIST_WINDOW_SECONDS = 10 * 60;

/**
 * Upstream failures used to be flattened into `400 + message`, which meant the
 * client could not tell "your playlist is wrong" from "we are throttled" — so
 * the UI told throttled hosts to check their URL, and they retried into an
 * already-spent quota. Pass the meaningful statuses through instead.
 *
 * 503 is the third of those: a short link the server could not follow *this
 * time* (`playlist_shortlink_unavailable`). It is ours and it is temporary,
 * and a 400 would file it in the logs beside the links that are simply wrong.
 * The client decides whether to ask again from the code, never the status.
 */
function statusFor(err: unknown): number {
  if (!(err instanceof SpotifyApiError)) return 400;
  if (err.status === 429 || err.status === 404 || err.status === 503) return err.status;
  return 400;
}

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "playlist:load",
    PLAYLIST_LIMIT,
    PLAYLIST_WINDOW_SECONDS,
    "rate_limited_playlist"
  );
  if (limited) return limited;

  try {
    const body = await req.json();
    const { url } = body as { url: string };

    if (!url || typeof url !== "string") {
      return errorResponse("missing_playlist_url", 400);
    }

    const { name, tracks, totalTracks, truncated } = await loadPlaylist(
      url,
      "playlist-api"
    );

    if (tracks.length < 1) {
      return errorResponse("playlist_empty", 400);
    }

    return NextResponse.json({ name, tracks, totalTracks, truncated });
  } catch (err: unknown) {
    const status = statusFor(err);
    // English, from the code — this line is a server log, and the sentence the
    // host reads is rendered on their device from `code` instead.
    console.error("[/api/playlist]", status, err instanceof Error ? err.message : err);

    if (err instanceof SpotifyApiError) {
      return errorResponse(err.code, status, {
        params: err.params,
        retryAfter: err.status === 429 ? err.retryAfterSeconds : undefined,
      });
    }

    return errorResponse("playlist_load_failed", status);
  }
}
