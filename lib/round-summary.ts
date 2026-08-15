/**
 * What a finished Mixed Playlist game looked like, in three numbers.
 *
 * ## Why this exists at all
 *
 * `lib/round-history.ts` has been recording every round's outcome since v1.5
 * and nothing but the taste card has ever read it. That is fine for an award,
 * which only needs to name a winner, and useless for the question that actually
 * decides what to build next: **how much of the scoring worked in this room.**
 *
 * A cross-culture party is where that question stops being academic. Two rooms
 * can produce the same final scoreboard while one of them had a song title
 * named almost every round and the other had the host tapping "No one" three
 * times a round because nobody in the room had heard any of it. The scoreboard
 * cannot tell those apart. This can, and it prints on the screen the host is
 * already looking at, which is the only place a number gets read without
 * someone deciding to go and find it.
 *
 * ## Read the counts, not a rate
 *
 * There is deliberately no percentage here. The denominator is rounds *played*,
 * which is not rounds *possible* — a host who ends a game early leaves the rest
 * unrecorded — so a rate would invite comparison between games of different
 * lengths that were stopped for different reasons. Counts with their total
 * stated are honest about being a description of one evening.
 */

import type { RoundHistoryEntry } from "@/lib/round-history";

export interface RoundSummary {
  /** Rounds that produced a history entry. Mixed-mode rounds only. */
  played: number;
  /**
   * Rounds where nobody was awarded the song point.
   *
   * **Includes rounds the host skipped past without awarding anything**, which
   * is why the field is named for what was recorded rather than for what the
   * room knew. A host moving quickly and a room that genuinely could not name
   * the track are indistinguishable here, and pretending otherwise would put a
   * confident claim on the screen that the data cannot support.
   */
  unnamed: number;
  /** Rounds where someone correctly named whose playlist the track came from. */
  sourceCorrect: number;
}

export function summarizeRounds(history: readonly RoundHistoryEntry[]): RoundSummary {
  let unnamed = 0;
  let sourceCorrect = 0;

  for (const entry of history) {
    if (entry.songWinner === null) unnamed += 1;
    if (entry.sourceWinner !== null) sourceCorrect += 1;
  }

  return { played: history.length, unnamed, sourceCorrect };
}

/**
 * One line for the Game Over screen, or null when there is nothing to say.
 *
 * Null rather than a zero-filled sentence for the empty case: a game that
 * recorded no rounds is a non-mixed game or an abandoned one, and printing
 * "0 of 0 songs nobody could name" on either of them is noise dressed as a
 * finding. The caller renders nothing.
 */
export function describeRounds(summary: RoundSummary): string | null {
  if (summary.played === 0) return null;
  return (
    `${summary.unnamed} of ${summary.played} songs nobody could name` +
    ` · ${summary.sourceCorrect} traced back to the right playlist`
  );
}
