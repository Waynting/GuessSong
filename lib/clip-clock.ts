/**
 * How much of a clip the room has actually heard.
 *
 * A clip is 5–30 seconds of *sound*, and sound comes in segments: a buzz holds
 * it, Resume hands the rest back, and the element takes however long it takes
 * to start. So the time is banked per segment rather than measured from one
 * start timestamp — without that a 15s clip paused for 20s ended the moment it
 * resumed, because the deadline was wall clock and not playback.
 *
 * This used to be two refs and some arithmetic in `app/game/page.tsx`, and
 * that arithmetic closed a segment by subtracting a start time whether or not
 * a segment was open. It was safe only because the timers started the moment
 * `play()` was called, so one was always open. They start when the element
 * reports sound now (`lib/clip-start.ts`), and under that rule the same
 * arithmetic would let a buzz that lands while a clip is still loading bank
 * the whole interval since the *previous* segment began — and hand the clip
 * back with its window already spent. `close` is a no-op when nothing is
 * open, and it lives here so that has a test (`tests/clip-clock.test.ts`).
 *
 * Every method takes the time rather than reading it, so nothing here needs a
 * fake clock to be tested.
 */
export interface ClipClock {
  /** Sound started. Opening an open segment is a no-op, not a restart. */
  open(now: number): void;
  /** Sound stopped: bank the open segment. A no-op when none is open. */
  close(now: number): void;
  /** Back to the top of the clip — a new round, a Replay, a repaired URL. */
  reset(): void;
  /**
   * The window ran out. Banks all of it, so a later Resume knows the clip is
   * spent and plays on instead of re-arming a countdown that already finished.
   */
  spend(totalMs: number): void;
  /** Banked time plus the open segment's. */
  elapsed(now: number): number;
  /** Whether a segment is open — i.e. whether the timers should be running. */
  running(): boolean;
}

export function createClipClock(): ClipClock {
  let banked = 0;
  let openedAt: number | null = null;

  return {
    open(now) {
      if (openedAt === null) openedAt = now;
    },
    close(now) {
      if (openedAt === null) return;
      // A clock that stepped backwards must not un-hear part of the clip.
      banked += Math.max(0, now - openedAt);
      openedAt = null;
    },
    reset() {
      banked = 0;
      openedAt = null;
    },
    spend(totalMs) {
      banked = Math.max(banked, totalMs);
      openedAt = null;
    },
    elapsed(now) {
      return banked + (openedAt === null ? 0 : Math.max(0, now - openedAt));
    },
    running() {
      return openedAt !== null;
    },
  };
}
