import { NextRequest, NextResponse } from "next/server";
import { classifySpotifyLink } from "@/lib/spotify-link";
import { shareDestination } from "@/lib/share-target";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Only the branch that makes a request is counted. A shared playlist link is
 * a string match and a redirect; a shared short link is an outbound fetch and
 * a KV write keyed by whatever slug was sent, and this is a `GET` anyone can
 * call — without a limit, `/share?url=spotify.link/<random>` is a free way
 * to fill KV a key at a time. Twenty is far more shares than a person makes
 * in ten minutes.
 *
 * `rateLimit` rather than `enforceRateLimit`, because a refusal here must not
 * be a JSON 429: this is a navigation from the share sheet, and the person
 * would be looking at a response body. See `mayResolve` for what they get.
 */
const SHARE_RESOLVE_LIMIT = 20;
const SHARE_RESOLVE_WINDOW_SECONDS = 10 * 60;

/**
 * Web Share Target endpoint (see public/manifest.json → share_target).
 * Receives whatever the user shared from the Android share sheet, extracts a
 * Spotify playlist, and lands them on the setup page with the URL prefilled.
 *
 * Every branch redirects. Where to is `shareDestination` in
 * lib/share-target.ts, which is in `lib/` so the rule has a test.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = [p.get("url"), p.get("text"), p.get("title")]
    .filter(Boolean)
    .join(" ");

  let mayResolve = true;
  if (classifySpotifyLink(raw).kind === "shortlink") {
    const { allowed } = await rateLimit(
      `share:resolve:${getClientIp(req)}`,
      SHARE_RESOLVE_LIMIT,
      SHARE_RESOLVE_WINDOW_SECONDS
    );
    mayResolve = allowed;
  }

  const destination = await shareDestination(raw, { mayResolve });

  if (destination.to === "setup") {
    const target = new URL("/", req.url);
    target.searchParams.set("playlist", destination.playlistUrl);
    target.searchParams.set("utm_source", "share_target");
    return NextResponse.redirect(target, 302);
  }

  // track / album / artist / plain text → friendly explanation page
  const fallback = new URL("/share/unsupported", req.url);
  fallback.searchParams.set("type", destination.type);
  return NextResponse.redirect(fallback, 302);
}
