import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const track = searchParams.get("track") ?? "";
  const artist = searchParams.get("artist") ?? "";

  if (!track) return NextResponse.json({ previewUrl: null });

  // iTunes Search API — free, no auth, reliable 30s previews
  const itunesQueries = [
    `${track} ${artist}`.trim(),
    track,
  ];

  for (const q of itunesQueries) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=musicTrack&limit=10`,
        { headers: { "Accept": "application/json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const results = data.results as Array<{ previewUrl?: string; trackName?: string; artistName?: string }> | undefined;
      // Prefer exact track name match, fall back to first with a preview
      const exact = results?.find(
        (r) => r.previewUrl && r.trackName?.toLowerCase() === track.toLowerCase()
      );
      const any = results?.find((r) => r.previewUrl);
      const match = exact ?? any;
      if (match?.previewUrl) {
        return NextResponse.json({ previewUrl: match.previewUrl });
      }
    } catch {
      continue;
    }
  }

  // Deezer fallback
  const deezerQueries = [
    `track:"${track}" artist:"${artist}"`,
    `${track} ${artist}`.trim(),
    track,
  ];

  for (const q of deezerQueries) {
    try {
      const res = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`,
        { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const match = (data.data as Array<{ preview?: string }> | undefined)?.find((r) => r.preview);
      if (match?.preview) {
        return NextResponse.json({ previewUrl: match.preview });
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ previewUrl: null });
}
