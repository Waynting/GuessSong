import { NextRequest, NextResponse } from "next/server";
import { getPlaylistWithTracks } from "@/lib/spotify";
import { enforceRateLimit } from "@/lib/rate-limit";

// The most expensive route we have: one playlist load pages through every
// track (50 per request), so a 500-track playlist is 10+ upstream calls.
// Generous enough for a host trying several playlists back to back, tight
// enough that it can't be used to burn the Spotify quota.
const PLAYLIST_LIMIT = 30;
const PLAYLIST_WINDOW_SECONDS = 10 * 60;

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

    const { playlist, tracks } = await getPlaylistWithTracks(url);

    if (tracks.length < 1) {
      return NextResponse.json(
        { error: "This playlist has no tracks." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      name: playlist.name,
      tracks,
      totalTracks: tracks.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch playlist";
    console.error("[/api/playlist]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
