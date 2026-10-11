/**
 * How many people a game was for, and whether anyone scored, as key tails.
 *
 * In a module with no imports, for the reason `lib/setup-source.ts` gives:
 * the setup page and both game pages compute these at runtime, and
 * `lib/loop-stats.ts` imports the KV client. `lib/loop-stats.ts` re-exports
 * both lists so the key map and its guards hold to the same ones.
 *
 * Both exist for one question. The largest pile in `npm run stats` is games
 * left at rounds 1–2, mostly by first-time hosts, and heaviest on a starter
 * playlist — which reads either as someone alone trying the site, or as a
 * party the first rounds lost. The two call for opposite work (the landing
 * page versus the game), and neither the host kind nor the source can tell
 * them apart. A one-player game nobody scored in is the first; a room of
 * four with points on the board is the second.
 */

/**
 * The size of the scoreboard, in four bands: `p1` is nobody to play against
 * (zero folds in here — a buzzer room that nobody joined), `p2` a duel, then a
 * small room and a big one. Bands rather than the count because the count is
 * a key tail arriving from a page.
 */
export type PlayerBand = "p1" | "p2" | "p3_4" | "p5_plus";

export const PLAYER_BANDS: readonly PlayerBand[] = ["p1", "p2", "p3_4", "p5_plus"];

export function playerBand(count: number): PlayerBand {
  if (!Number.isFinite(count) || count <= 1) return "p1";
  if (count === 2) return "p2";
  return count <= 4 ? "p3_4" : "p5_plus";
}

export function isPlayerBand(value: unknown): value is PlayerBand {
  return typeof value === "string" && (PLAYER_BANDS as readonly string[]).includes(value);
}

/**
 * Whether any point had been awarded when the game ended or the page went
 * away. Scores only ever go up (every award adds), so "someone has more than
 * zero" is "the host pressed an award at least once" — someone was guessing
 * and someone was judging.
 */
export type GameScored = "scored" | "unscored";

export const GAME_SCORED: readonly GameScored[] = ["scored", "unscored"];

export function gameScored(players: readonly { score: number }[]): GameScored {
  return players.some((p) => p.score > 0) ? "scored" : "unscored";
}

export function isGameScored(value: unknown): value is GameScored {
  return typeof value === "string" && (GAME_SCORED as readonly string[]).includes(value);
}
