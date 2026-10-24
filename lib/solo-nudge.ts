/**
 * The setup page's one-line nudge for a host who is on their own.
 *
 * Most games are one person. In the week to 2026-10-24, 68% of the games that
 * said how many were playing said one, and those played out 11.9% of the time
 * against 38.5% for a room of three or four; of that week's round 1–2 leaves,
 * 4,134 had no points on the board and 460 did. The guess game cannot be
 * played alone — the host is the judge, and alone there is nobody to judge —
 * while "put them in order" scores a one-player game from the screen at the
 * reveal (`app/order/page.tsx`) and fetches no clip, so it is the one thing on
 * the site built for the person the site mostly gets. The nudge appears at the
 * moment that is plain — one name typed and no second — and offers that game.
 * What it measures is whether a solo visitor wants to play alone at all,
 * which is the question the first-visit work after it depends on.
 *
 * Lives in `lib/` for the reason `lib/mixed-nudge.ts` does: the suite cannot
 * import `app/page.tsx`, and a condition that quietly stopped being true
 * would look like a nudge nobody tapped.
 *
 * Counted as `solo_nudge:<stage>` (`lib/loop-stats.ts`): `shown` once per
 * page load, `tapped`, and `started` for an order game started after a tap on
 * this page. `started ÷ tapped` says whether the line works;
 * `game_end_mode_players:order:p1:*` against `…:party:p1:*` says whether the
 * game it sends them to keeps them.
 */

import type { PlayStyle } from "@/lib/order-game";
import type { SetupMode } from "@/lib/start-status";

export interface SoloNudgeInputs {
  setupMode: SetupMode;
  /** Buzzer Mode hides the roster this counts, so the nudge has nothing to sit under. */
  buzzerEnabled: boolean;
  /** The roster as typed, blanks included. */
  players: readonly string[];
  /** Already on the order game: there is nothing to offer. */
  playStyle: PlayStyle;
}

/**
 * Exactly one typed name. The default roster is two blank rows, so blanks are
 * not counted — a host who has typed one name and left "Player 2" empty is
 * the case, not a host who has added a row.
 */
export function showSoloNudge({
  setupMode,
  buzzerEnabled,
  players,
  playStyle,
}: SoloNudgeInputs): boolean {
  if (setupMode !== "single" || buzzerEnabled || playStyle === "order") return false;
  return players.filter((name) => name.trim()).length === 1;
}
