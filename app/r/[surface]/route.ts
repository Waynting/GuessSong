import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { handleLoopHit } from "@/lib/loop-redirect";

/**
 * Every loop link goes through here: the footers and calls to action on the
 * player-facing pages, and the QR printed on the result card. The server
 * counts the hit and forwards to the setup page, so the click is measured by
 * the navigation itself rather than by a background request the browser is
 * about to cancel.
 *
 * The decision lives in `lib/loop-redirect.ts`. This file is deliberately a
 * shell — it resolves the segment, asks the limiter, and builds a response.
 *
 * Not in the sitemap, and disallowed in `app/robots.ts`: it is plumbing, it
 * returns no content, and a crawler walking it would both waste crawl budget
 * and inflate the counter.
 */

/**
 * Generous on purpose. The limiter is keyed by IP and a party is a dozen
 * phones sharing one Wi-Fi egress address, so the honest unit here is "a
 * household for an evening", not "a person". `app/api/room/[code]/status`
 * already taught this lesson the expensive way: a per-IP bucket sized for one
 * device throttles the whole room. 120 an hour is far past anything a real
 * party produces and still bounds a script.
 */
const LOOP_LIMIT = 120;
const LOOP_WINDOW_SECONDS = 60 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ surface: string }> }
) {
  const { surface } = await params;

  // Fail *open*: if the limiter itself is unavailable the click still counts.
  // Losing KV must mean "back to how it was", not "stop measuring" — and
  // certainly not "stop redirecting".
  let allowed = true;
  try {
    const ip = getClientIp(req);
    ({ allowed } = await rateLimit(
      `loop:${ip}`,
      LOOP_LIMIT,
      LOOP_WINDOW_SECONDS
    ));
  } catch {
    allowed = true;
  }

  const outcome = await handleLoopHit(surface, allowed);

  const res = NextResponse.redirect(new URL(outcome.destination, req.url), 302);
  // Without this an intermediary can cache the 302 and every later click from
  // that network is served without ever reaching the counter — the redirect
  // would keep working while the measurement quietly stopped, which is the
  // exact failure this route was built to avoid.
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
