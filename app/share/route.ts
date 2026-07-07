import { NextRequest, NextResponse } from "next/server";
import {
  parseSharedText,
  playlistUrlFromId,
  resolveShortlink,
} from "@/lib/share-target";

/**
 * Web Share Target endpoint (see public/manifest.json → share_target).
 * Receives whatever the user shared from the Android share sheet, extracts a
 * Spotify playlist, and lands them on the setup page with the URL prefilled.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = [p.get("url"), p.get("text"), p.get("title")]
    .filter(Boolean)
    .join(" ");

  let parsed = parseSharedText(raw);
  if (parsed.kind === "shortlink") {
    parsed = await resolveShortlink(parsed.url);
  }

  if (parsed.kind === "playlist") {
    const target = new URL("/", req.url);
    target.searchParams.set("playlist", playlistUrlFromId(parsed.id));
    target.searchParams.set("utm_source", "share_target");
    return NextResponse.redirect(target, 302);
  }

  // track / album / artist / plain text → friendly explanation page
  const fallback = new URL("/share/unsupported", req.url);
  fallback.searchParams.set("type", parsed.kind);
  return NextResponse.redirect(fallback, 302);
}
