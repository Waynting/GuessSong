/**
 * Server-side counters for the loop, in KV.
 *
 * ## Why these are not simply GA4 events
 *
 * They are also GA4 events. This is the second copy, and it exists because the
 * numbers have to arrive somewhere without anyone going to fetch them. Four
 * separate attempts to read the GA4 dashboard have not happened, so any plan
 * whose payoff is "and then open Analytics" has a measured completion rate of
 * zero and must be designed around rather than repeated. GA4 keeps the
 * cohorting and the exploration; this is the half that gets read.
 *
 * **The reader is `npm run stats` (`scripts/loop-stats.mjs`), not a pushed
 * digest.** An emailed weekly digest was designed and then dropped in favour of
 * a command, so anything here describing "the digest" was describing a file
 * that does not exist — `lib/digest.ts` was never written. The distinction
 * matters when adding a metric: the script discovers keys with `KEYS` rather
 * than being handed a list, so a new counter needs no registration to be
 * *counted*, only to be *named* well enough to read.
 *
 * The two will disagree, and that is expected: an ad blocker kills the GA4
 * event and not the redirect, while a spent rate-limit window drops the KV
 * increment and not the GA4 event. **KV is authoritative.**
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
 * A report reads a week at a time, so a 7-day TTL would expire the oldest day
 * or two of every single one right before it was read — and, worse, an expired
 * key is indistinguishable from one that was never written, so the loss would
 * render as "no data yet" rather than as a gap. 30 days also leaves room to go
 * a few weeks without looking and still be able to look back.
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

/**
 * Which of Mixed Playlist Mode's two collection routes built a game's pool.
 *
 * Lives here rather than in `lib/pulse.ts` for the same reason
 * `HOST_INDEX_CEILING` does: this module owns the `loop:stats:` key space, and
 * these two strings become the tail of a key. A guard over this list is what
 * stands between an unauthenticated request body and `mixed_pool:${anything}`.
 *
 * The sub-mode rides on `game_started` rather than arriving as an event of its
 * own, because it is a property of the game that started rather than a second
 * thing that happened. All three hosted-start paths already send that event
 * (`recordHostedStart` in `app/page.tsx`), so a separate event would have
 * described one occurrence twice and doubled a mixed game's KV cost for no
 * extra fact.
 *
 * Both values are needed because neither is visible anywhere else. The
 * `join_submitted` surface is rendered only by `/j/[code]`, and `roomJoinUrl`
 * sends players to `/buzz/[code]` whenever the buzzer is on — so a QR room with
 * a buzzer, which is the ordinary configuration, and the whole `"phone"` route
 * are both invisible to every counter that existed before this one.
 */
export type MixedSubMode = "room" | "phone";

export const MIXED_SUB_MODES: readonly MixedSubMode[] = ["room", "phone"];

function key(day: string, metric: string): string {
  return `loop:stats:${day}:${metric}`;
}

/**
 * Every key one day of counters can hold.
 *
 * `scripts/loop-stats.mjs` discovers keys with `KEYS` rather than reading this,
 * so it is not the reader's contract; it is the writer's own description of
 * itself, and `tests/loop-stats.test.ts` is what holds the two together. That
 * makes it easy to forget when adding a metric, and forgetting is silent — the
 * test asserts with `toContain`, so a key missing from here fails nothing. Add
 * the field anyway: the value of this function is that one place answers "what
 * can exist under `loop:stats:`", and a description that is only mostly true is
 * the kind that gets trusted right up until it is wrong.
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
  mixedPool: Record<MixedSubMode, string>;
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
    mixedPool: {
      room: key(day, "mixed_pool:room"),
      phone: key(day, "mixed_pool:phone"),
    },
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
export async function recordGameStart(
  hostGameIndex: number,
  mixed?: MixedSubMode
): Promise<void> {
  const index = Number.isFinite(hostGameIndex)
    ? Math.max(1, Math.min(Math.trunc(hostGameIndex), HOST_INDEX_CEILING))
    : 1;
  await bump("games");
  await bump(`host_index:${index}`);
  if (index >= 2) await bump("repeat_host");
  // One extra command on a mixed game and none on any other. The alternative
  // considered was a second pulse event, which would have carried its own
  // liveness marker and cost a mixed game eight commands where this costs five.
  if (mixed) await bump(`mixed_pool:${mixed}`);
}
