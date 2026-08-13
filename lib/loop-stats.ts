/**
 * Server-side counters for the loop, in KV.
 *
 * ## Why these are not simply GA4 events
 *
 * They are also GA4 events. This is the second copy, and it exists because the
 * numbers have to arrive somewhere without anyone going to fetch them. Four
 * separate attempts to read the GA4 dashboard have not happened, so any plan
 * whose payoff is "and then open Analytics" has a measured completion rate of
 * zero and must be designed around rather than repeated. These counters feed a
 * digest that is pushed. GA4 keeps the cohorting and the exploration; this is
 * the half that gets read.
 *
 * The two will disagree, and that is expected: an ad blocker kills the GA4
 * event and not the redirect, while a spent rate-limit window drops the KV
 * increment and not the GA4 event. **KV is authoritative for the digest.**
 *
 * ## Every function here is fail-soft
 *
 * Same contract as `lib/playlist-cache.ts` and `lib/preview-cache.ts`: losing
 * the safety net has to mean "back to how it was", never "the feature broke".
 * A counter that can fail a redirect is a counter that costs you the user it
 * was trying to measure.
 */

import { dayBucket, getKvStore } from "@/lib/kv";
import type { LoopSurface } from "@/lib/loop-links";

/**
 * 30 days, not the 7 that `lib/playlist-cache.ts` uses for its own stats.
 *
 * The digest reports a week at a time and its window ends a couple of days
 * back, so a 7-day TTL would expire the oldest day or two of every single
 * report right before it was read — and, worse, an expired key is
 * indistinguishable from one that was never written, so the loss would render
 * as "no data yet" rather than as a gap. 30 days also leaves room to miss a
 * few weeks of digests and still be able to look back.
 */
export const LOOP_STATS_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Above this, `host_game_index` stops getting its own key.
 *
 * The index comes from a client counter, so without a ceiling the key space is
 * unbounded and one loop in a console fills KV with `host_index:99999` keys.
 * Ten is far past the point where the question ("does anyone host twice?") has
 * been answered.
 */
export const HOST_INDEX_CEILING = 10;

function key(day: string, metric: string): string {
  return `loop:stats:${day}:${metric}`;
}

/**
 * Every key the digest reads for one day.
 *
 * Exported so the reader and the writers derive their keys from one place —
 * the failure mode of two hand-written key formats is that the digest reads a
 * key nobody writes, reports zero, and never errors.
 */
export function loopStatsKeys(
  day: string,
  surfaces: readonly LoopSurface[]
): {
  live: string;
  throttled: string;
  games: string;
  repeatHost: string;
  impressions: Record<string, string>;
  clicks: Record<string, string>;
  hostIndex: string[];
} {
  const impressions: Record<string, string> = {};
  const clicks: Record<string, string> = {};
  for (const surface of surfaces) {
    impressions[surface] = key(day, `impression:${surface}`);
    clicks[surface] = key(day, `click:${surface}`);
  }
  const hostIndex: string[] = [];
  for (let n = 1; n <= HOST_INDEX_CEILING; n += 1) {
    hostIndex.push(key(day, `host_index:${n}`));
  }
  return {
    live: key(day, "live"),
    throttled: key(day, "throttled"),
    games: key(day, "games"),
    repeatHost: key(day, "repeat_host"),
    impressions,
    clicks,
    hostIndex,
  };
}

/**
 * The day this instance has already written the liveness marker for.
 *
 * The marker answers one yes/no question — did the counters run at all today —
 * and its reader treats it that way: `scripts/loop-stats.mjs` only asks whether
 * the count is above zero, never what it is. Writing it alongside *every*
 * metric therefore bought nothing and doubled the cost of the whole loop
 * namespace; `recordGameStart` alone spent six commands where four would do,
 * and three of the six were the same key.
 *
 * Once per instance per UTC day is the cheapest thing that still cannot go
 * wrong. A lambda that serves one request writes it; a lambda that serves ten
 * thousand still writes it once; a fleet of instances writes it a handful of
 * times, which is a handful more than necessary and far fewer than before. The
 * only way to lose the marker is for every instance that ran that day to fail
 * its write, which is the KV outage the marker would be reporting anyway.
 *
 * Set only after a successful write, so an instance that fails once still tries
 * again on its next event rather than believing it has already reported.
 */
let livenessWrittenForDay: string | null = null;

/**
 * Bumps a counter, and the day's liveness marker if this instance has not yet.
 *
 * Without the marker a day with no clicks and a day the counters never ran look
 * identical: `mget` returns null for a key that was never created, which is
 * exactly what a genuine zero also looks like. Printing both as "no data yet"
 * would hide the single most important negative result this whole exercise can
 * produce — that the CTA does nothing. With a liveness marker, null-and-live is
 * a real zero and null-and-dead is a plumbing problem.
 */
async function bump(metric: string, by = 1): Promise<void> {
  try {
    const store = await getKvStore();
    const day = dayBucket();
    await store.incr(key(day, metric), LOOP_STATS_TTL_SECONDS, by);
    if (livenessWrittenForDay === day) return;
    await store.incr(key(day, "live"), LOOP_STATS_TTL_SECONDS);
    livenessWrittenForDay = day;
  } catch {
    // Instrumentation must never be able to fail a request.
  }
}

/**
 * Test seam: the liveness memo is module state that outlives a single test, so
 * without this every case after the first would see the marker already written.
 */
export function __resetLivenessForTests(): void {
  livenessWrittenForDay = null;
}

/** A loop surface was rendered to someone. The denominator. */
export function recordLoopImpression(surface: LoopSurface): Promise<void> {
  return bump(`impression:${surface}`);
}

/** Someone followed a loop link. The numerator. */
export function recordLoopClick(surface: LoopSurface): Promise<void> {
  return bump(`click:${surface}`);
}

/**
 * A click that was not counted because the window was spent.
 *
 * Recorded so the undercount is visible in the digest instead of silently
 * depressing the click rate. A party is a dozen phones behind one NAT and the
 * limiter is keyed by IP, so this is a normal occurrence, not an attack.
 */
export function recordLoopThrottled(): Promise<void> {
  return bump("throttled");
}

/**
 * A hosted game started, and which number it was for this device.
 *
 * `hostGameIndex` is 1 for a first-time host. Anything at or above 2 is the
 * number the whole plan is waiting on: proof that someone came back. It is a
 * floor and not a measurement — iOS evicts localStorage after seven days
 * without interaction, which is exactly the gap between two parties, so a host
 * on a monthly rhythm reads as first-time forever.
 */
export async function recordGameStart(hostGameIndex: number): Promise<void> {
  const index = Number.isFinite(hostGameIndex)
    ? Math.max(1, Math.min(Math.trunc(hostGameIndex), HOST_INDEX_CEILING))
    : 1;
  await bump("games");
  await bump(`host_index:${index}`);
  if (index >= 2) await bump("repeat_host");
}
