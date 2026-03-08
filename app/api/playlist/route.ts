import { NextRequest, NextResponse } from "next/server";
import { getPlaylistWithTracks } from "@/lib/spotify";

export async function POST(req: NextRequest) {
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
