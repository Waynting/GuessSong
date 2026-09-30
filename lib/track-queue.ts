/**
 * The queue of rounds still to play, with the known-silent ones taken out.
 *
 * ## The promise this keeps
 *
 * The FAQ on `/` says "the few songs with no preview anywhere are skipped".
 * They were not. The batch prefetch filled the preview cache and the queue was
 * never touched, so the host found out a track had no clip by pressing Play on
 * it — "No audio for this track", Reveal or Skip, every time, for a fact the
 * page had known since before round one.
 *
 * ## The four things it must never remove
 *
 * - **The track on screen.** Its card is up and the host may be mid-press;
 *   taking it out from under them changes which song `currentIndex` points at.
 * - **Anything already played.** Those rounds are in the scoreboard, and in
 *   Mixed mode in the round history. Removing one would also shift
 *   `currentIndex` onto a different track without the host doing anything.
 * - **An `unavailable` track.** That is a fact about us — throttled, out of
 *   budget — and it clears. `previewCache` never stores one, so it reads here
 *   as `undefined`, the same as a track nobody has asked about. Treating
 *   either as silent is the absent/unavailable collapse CLAUDE.md records as
 *   a bug that shipped, moved one step on: one throttled minute at the start
 *   of a party would delete a slice of the playlist for the evening.
 * - **A track past the batch's cap.** `PREVIEW_BATCH_MAX` tracks are
 *   prefetched and the rest resolve lazily; unasked is `undefined` too.
 *
 * So the test is strictly `=== null`: a settled, clean "nothing anywhere has a
 * clip". A track that turns out `absent` on the lazy path, when the host
 * reaches it, keeps the behaviour it had — by then it *is* the track on
 * screen.
 *
 * Pure, and in `lib/`, for the reason `lib/round-token.ts` gives.
 */

export interface SilentDrop<T> {
  /** The same array when nothing was dropped, so a caller can skip the render. */
  queue: readonly T[];
  dropped: number;
}

export function dropSilentUpcoming<T extends { id: string }>(
  queue: readonly T[],
  currentIndex: number,
  settled: Readonly<Record<string, string | null | undefined>>
): SilentDrop<T> {
  // A nonsense index keeps everything. The only caller passes a ref it has
  // been maintaining, but "when in doubt, remove nothing" is the direction
  // that cannot cost a host a song.
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return { queue, dropped: 0 };

  const kept = queue.filter(
    (track, index) =>
      index <= currentIndex ||
      // `hasOwn`, not a bare lookup: the cache is a plain object keyed by a
      // string that came off the wire, and `settled["constructor"]` is a
      // function, not an answer.
      !Object.prototype.hasOwnProperty.call(settled, track.id) ||
      settled[track.id] !== null
  );
  const dropped = queue.length - kept.length;
  return dropped === 0 ? { queue, dropped: 0 } : { queue: kept, dropped };
}

/**
 * The one line the host is shown about it, or null when there is nothing to
 * say. Says "no preview anywhere" because that is the FAQ's phrase and the
 * claim the code can stand behind — not "unavailable", which is our word for
 * the other thing.
 */
export function silentSkippedLine(dropped: number): string | null {
  if (!Number.isFinite(dropped) || dropped < 1) return null;
  return dropped === 1
    ? "1 song with no preview anywhere was skipped"
    : `${dropped} songs with no preview anywhere were skipped`;
}
