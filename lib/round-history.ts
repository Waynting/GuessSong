/**
 * Per-round scoring record for Mixed Playlist Mode, kept only for tracks
 * that have `contributors` (i.e. mixed-mode rounds). Read by the taste card
 * (`lib/taste-card.ts`) and the Game Over summary line (`lib/round-summary.ts`).
 */
export interface RoundHistoryEntry {
  trackId: string;
  contributors: string[];
  songWinner: string | null;
  albumWinner: string | null;
  sourceWinner: string | null;
  /**
   * Whether the answer card was up when the round closed. A round skipped
   * before the reveal (a "No audio" track, a host moving on) was never put to
   * the room, so its null `sourceWinner` is not a failed attribution — the
   * taste card must not count it as one. The summary line still counts it as
   * played and unnamed, which is what that line documents.
   */
  revealed: boolean;
}

export interface ClosingRound {
  track: { id: string; contributors?: string[] } | undefined;
  revealed: boolean;
  songWinner: string | null;
  albumWinner: string | null;
  sourceWinner: string | null;
  /**
   * `next`: the host pressed Next Track / Skip Track, so the round is over
   * whether or not it was revealed. `end`: the host pressed End Game with
   * this round on screen — only a revealed round was played; an unrevealed
   * one is abandoned, like every round after it.
   */
  via: "next" | "end";
}

/**
 * The history entry for the round on screen, or null when it records nothing.
 * The one rule for both round-closing paths in `app/game/page.tsx`: End Game
 * used to append nothing, so a source point awarded on the last revealed
 * round vanished from the summary and the taste card.
 */
export function closeRoundEntry(round: ClosingRound): RoundHistoryEntry | null {
  const contributors = round.track?.contributors;
  if (!round.track || !contributors || contributors.length === 0) return null;
  if (round.via === "end" && !round.revealed) return null;
  return {
    trackId: round.track.id,
    contributors,
    songWinner: round.songWinner,
    albumWinner: round.albumWinner,
    sourceWinner: round.sourceWinner,
    revealed: round.revealed,
  };
}
