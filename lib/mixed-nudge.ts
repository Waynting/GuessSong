/**
 * The setup page's one-line nudge toward Mixed Playlist Mode.
 *
 * Mixed is the loop arm that converts — a player who submits a playlist to a
 * room goes on to host about a fifth of the time, several times any other arm
 * — and it was about 1% of games, reached only by a text link under Start. A
 * pill row for it was taken off the card on purpose: most games are one
 * playlist, and a mode switch above the form is noise to all of them. So the
 * nudge appears at the one moment Mixed plainly fits — the host has typed a
 * room's worth of names — and nowhere else.
 *
 * Lives in `lib/` for the reason `lib/start-status.ts` does: the suite cannot
 * import `app/page.tsx`, and a condition that quietly stopped being true
 * would look like a nudge nobody tapped.
 *
 * Counted as `mixed_nudge:<stage>` (`lib/loop-stats.ts`): `shown` once per
 * page load, `tapped`, and `started` for a Mixed game started after a tap.
 * `started ÷ tapped` is the number that says whether it works.
 */

import type { SetupMode } from "@/lib/start-status";

/** Three: two people is a duel, and a mix of two playlists is barely a mix. */
export const MIXED_NUDGE_MIN_PLAYERS = 3;

export interface MixedNudgeInputs {
  setupMode: SetupMode;
  /** Buzzer Mode hides the roster this counts, so the nudge has nothing to sit under. */
  buzzerEnabled: boolean;
  /** The roster as typed, blanks included. */
  players: readonly string[];
}

export function showMixedNudge({ setupMode, buzzerEnabled, players }: MixedNudgeInputs): boolean {
  if (setupMode !== "single" || buzzerEnabled) return false;
  return players.filter((name) => name.trim()).length >= MIXED_NUDGE_MIN_PLAYERS;
}
