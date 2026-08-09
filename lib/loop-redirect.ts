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
import { recordLoopClick, recordLoopThrottled } from "@/lib/loop-stats";

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
 */
export async function handleLoopHit(
  rawSurface: string,
  allowed: boolean
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

  // Attribution rides on the query string so the setup page can read it after
  // the redirect. The surface is already narrowed, so nothing untrusted is
  // being reflected back into the URL.
  const destination = `${LOOP_FALLBACK_DESTINATION}?ref=${rawSurface}`;

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
