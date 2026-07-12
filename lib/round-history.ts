/**
 * Per-round scoring record for Mixed Playlist Mode, kept only for tracks
 * that have `contributors` (i.e. mixed-mode rounds). Not consumed yet —
 * seeded in v1.5 so v2's group taste card can compute its awards without
 * re-deriving history that's otherwise lost the moment a round resets.
 */
export interface RoundHistoryEntry {
  trackId: string;
  contributors: string[];
  songWinner: string | null;
  albumWinner: string | null;
  sourceWinner: string | null;
}
