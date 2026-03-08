import { NextRequest, NextResponse } from "next/server";
import { getPlaylistWithTracks } from "@/lib/spotify";
import type { Track } from "@/types";

async function fetchItunesPreview(trackName: string, artist: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${trackName} ${artist}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=5`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const match = data.results?.find((r: { previewUrl?: string }) => r.previewUrl);
    return match?.previewUrl ?? null;
  } catch {
    return null;
  }
}

async function enrichWithItunesPreviews(tracks: Track[]): Promise<Track[]> {
  const missing = tracks.filter((t) => !t.previewUrl);
  const hasPreview = tracks.filter((t) => t.previewUrl);

  if (missing.length === 0) return tracks;

  // Fetch iTunes previews in parallel (cap concurrency at 10)
  const enriched = await Promise.all(
    missing.map(async (track) => {
      const previewUrl = await fetchItunesPreview(track.name, track.artists[0] ?? "");
      return { ...track, previewUrl };
    })
  );

  return [...hasPreview, ...enriched].filter((t) => t.previewUrl);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body as { url: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing playlist URL" }, { status: 400 });
    }

    const { playlist, tracks } = await getPlaylistWithTracks(url);

    const playableTracks = await enrichWithItunesPreviews(tracks);

    if (playableTracks.length < 1) {
      return NextResponse.json(
        { error: "No playable tracks found. Could not find preview clips for any track in this playlist." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      name: playlist.name,
      tracks: playableTracks,
      totalTracks: tracks.length,
      playableTracks: playableTracks.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch playlist";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
