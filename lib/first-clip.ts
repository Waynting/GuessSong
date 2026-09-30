/**
 * The first clip of a game, reported once.
 *
 * ## What it is for
 *
 * "Ended early at round 1" was the tallest bar in `npm run stats` and nothing
 * could say why. The leading hypothesis is mechanical: when the batch prefetch
 * has not landed by the time the host presses Play, the page has to look the
 * clip up first, so `play()` runs after an `await` — outside the tap — and
 * iOS is entitled to refuse it. Round one is when the prefetch is least likely
 * to have landed. That is a guess, and this is what tests it: the path the
 * first press took, and how it came out.
 *
 * ## Why a tracker and not a boolean
 *
 * The outcome of a press arrives from six different places in the page — the
 * `playing` event, a rejected `play()`, the lookup's answer, the repair's
 * failure, a round teardown, the page going away — and any of them can come
 * first. A `sentRef` checked at each site is six chances to forget the check
 * or to set it in the wrong order. Here the press arms and the first `settle`
 * wins, so a call site cannot report twice however it is written, and cannot
 * report for a second press at all.
 *
 * **Only the first press arms it, even when that press came to nothing.** A
 * refused first press followed by a second that plays is one `rejected`, not
 * one `rejected` and one `played`: the counter is the first press's, and the
 * second tap working is what the fix looks like, not a second reading.
 */

import type { FirstClipOutcome, FirstClipPath } from "@/lib/loop-stats";

export interface FirstClipReport {
  path: FirstClipPath;
  outcome: FirstClipOutcome;
}

export interface FirstClipTracker {
  /** The host pressed Play. Every press after the first is ignored. */
  press(path: FirstClipPath): void;
  /**
   * The press came out. Returns the report to send the first time it is
   * called for an armed press, and null every other time — before any press,
   * after the first settle, from a later round.
   */
  settle(outcome: FirstClipOutcome): FirstClipReport | null;
  /** A press is armed and has not come out yet. */
  pending(): boolean;
}

export function createFirstClipTracker(): FirstClipTracker {
  let path: FirstClipPath | null = null;
  let settled = false;

  return {
    press(pressed) {
      if (path === null) path = pressed;
    },
    settle(outcome) {
      if (path === null || settled) return null;
      settled = true;
      return { path, outcome };
    },
    pending() {
      return path !== null && !settled;
    },
  };
}

/**
 * Which path a press takes, from what the preview cache holds for the track.
 *
 * `undefined` is "nobody has asked yet" and is the only lazy case. A cached
 * `null` is the prefetch having settled that nothing has a clip, which is
 * `prefetched` all the same — the press did not have to go and ask, and the
 * outcome (`no_audio`) says the rest.
 */
export function firstClipPath(cached: string | null | undefined): FirstClipPath {
  return cached === undefined ? "lazy" : "prefetched";
}
