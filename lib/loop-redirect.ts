/**
 * The decision behind `/r/[surface]`, kept out of the route so it can be tested.
 *
 * The route itself is a shell: read the segment, ask the limiter, call this,
 * build a 302. Everything that can be wrong is here.
 *
 * ## Why a redirect and not a background event
 *
 * The click being measured is the click that navigates away. A `fetch` fired at
 * that moment is routinely cancelled by the browser as the page tears down, so
 * the single most important number in the loop — did anyone actually follow the
 * call to action — would arrive undercounted by an unknown amount and read as
 * "nobody clicked". Routing the link through the server makes the navigation
 * itself the measurement. There is nothing left to cancel.
 *
 * ## The rule every branch obeys
 *
 * **The visitor always reaches the setup page.** Unknown segment, spent rate
 * limit, KV on fire: all of them still redirect. Only the count is allowed to
 * be lost. This is the same fail-open contract `lib/playlist-cache.ts` uses for
 * its global budget, and the reason is sharper here — the person clicking is
 * precisely the person this whole feature exists to reach, and refusing them to
 * protect an integer would be an own goal.
 */

import { isLoopSurface, type LoopSurface } from "@/lib/loop-links";
import { QUIZ_SETUP_HREF, isQuizSurface } from "@/lib/setup-arrival";
import { recordLoopClick, recordLoopThrottled } from "@/lib/loop-stats";
import { challengeLandingQuery } from "@/lib/challenge";

/**
 * The one surface whose redirect forwards more than `?ref=`. A challenge link
 * (`lib/challenge.ts`) carries the deal and the score to beat, and the friend
 * has to land on a form that already holds them. Every other surface's query
 * is dropped, as it always was: nothing else in it was ever meant for the page.
 */
const FORWARDS_QUERY: ReadonlySet<LoopSurface> = new Set<LoopSurface>(["challenge"]);

/** Where an unrecognised segment lands. Still the setup page, just unattributed. */
export const LOOP_FALLBACK_DESTINATION = "/";

export interface LoopHitOutcome {
  /** The recognised surface, or null when the segment was not one of ours. */
  surface: LoopSurface | null;
  /** Always a path. Always somewhere useful. */
  destination: string;
  /** Whether a click was added to the counters. */
  counted: boolean;
  /** True when a real click was dropped because the window was spent. */
  throttled: boolean;
}

/**
 * @param rawSurface the `[surface]` path segment, entirely untrusted
 * @param allowed    the limiter's verdict, resolved by the caller so this stays
 *                   free of `NextRequest`. Pass `true` when the limiter itself
 *                   failed — an unavailable limiter must not cost a count.
 * @param query      the hit's own query string, entirely untrusted. Read only
 *                   for a surface in `FORWARDS_QUERY`, and then only through
 *                   `challengeLandingQuery`, which re-validates every field and
 *                   rebuilds the string rather than passing any of it through.
 *                   Junk is dropped: the visitor still lands, still counted.
 */
export async function handleLoopHit(
  rawSurface: string,
  allowed: boolean,
  query: URLSearchParams = new URLSearchParams()
): Promise<LoopHitOutcome> {
  if (!isLoopSurface(rawSurface)) {
    // Not ours: a typo, a crawler, a hand-edited URL. Send them to the setup
    // page anyway — a 404 would be a worse answer to "I typed your address" —
    // but do not invent a surface for it, and do not spend a KV write on it.
    // Unbounded junk segments are exactly what would fill the key space.
    return {
      surface: null,
      destination: LOOP_FALLBACK_DESTINATION,
      counted: false,
      throttled: false,
    };
  }

  // Attribution rides on the query string so the landing page can read it
  // after the redirect. The surface is already narrowed, so nothing untrusted
  // is being reflected back into the URL. A click that followed a quiz lands
  // on the quiz's own page: the person was just promised "make your own", and
  // the party form is not that.
  const landing = isQuizSurface(rawSurface) ? QUIZ_SETUP_HREF : LOOP_FALLBACK_DESTINATION;
  const forwarded = FORWARDS_QUERY.has(rawSurface) ? challengeLandingQuery(query) : null;
  const destination = `${landing}?ref=${rawSurface}${forwarded ? `&${forwarded}` : ""}`;

  if (!allowed) {
    // A party is a dozen phones behind one NAT and the limiter is keyed by IP,
    // so being here is ordinary rather than hostile. Record that a click was
    // dropped, so the digest can say how far the number is understated instead
    // of quietly reporting a low one.
    await recordLoopThrottled();
    return { surface: rawSurface, destination, counted: false, throttled: true };
  }

  await recordLoopClick(rawSurface);
  return { surface: rawSurface, destination, counted: true, throttled: false };
}
