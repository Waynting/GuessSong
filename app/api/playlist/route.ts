import { NextRequest, NextResponse } from "next/server";
import { loadPlaylist } from "@/lib/playlist-cache";
import { SpotifyApiError } from "@/lib/spotify";
import { enforceRateLimit } from "@/lib/rate-limit";

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
 */
function statusFor(err: unknown): number {
  if (!(err instanceof SpotifyApiError)) return 400;
  if (err.status === 429 || err.status === 404) return err.status;
  return 400;
}

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "playlist:load",
    PLAYLIST_LIMIT,
    PLAYLIST_WINDOW_SECONDS,
    "Too many playlist loads, please slow down"
  );
  if (limited) return limited;

  try {
    const body = await req.json();
    const { url } = body as { url: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing playlist URL" }, { status: 400 });
    }

    const { name, tracks, totalTracks, truncated } = await loadPlaylist(url);

    if (tracks.length < 1) {
      return NextResponse.json(
        { error: "This playlist has no tracks." },
        { status: 400 }
      );
    }

    return NextResponse.json({ name, tracks, totalTracks, truncated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch playlist";
    const status = statusFor(err);
    console.error("[/api/playlist]", status, message);

    const headers =
      err instanceof SpotifyApiError && err.status === 429 && err.retryAfterSeconds
        ? { "Retry-After": String(Math.ceil(err.retryAfterSeconds)) }
        : undefined;

    return NextResponse.json({ error: message }, { status, headers });
  }
}
