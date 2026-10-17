/**
 * Did a host whose playlist was refused for good go on to start a game?
 *
 * The setup page refuses ~2,500 links a week that will never work — 1,300 of
 * them private or deleted — and shows help for each. `playlist_refused:<code>`
 * counts the refusals on the server, retries and replays included; nothing
 * said whether the host behind one then played. This is that number, per tab
 * (carried across a reload, below): `refused` the first time a permanent
 * refusal is shown, `recovered` when the same tab then starts a game, with how (`SetupSource`: a typed
 * link, a starter, a recent one, Mixed…).
 *
 * Keyed by help topic (`lib/playlist-help.ts`), not by error code: the topic
 * is what the host was told, it is the same predicate the help line and the
 * starter chips use (`isPermanentRefusal`), and it is safe in the browser —
 * `lib/loop-stats.ts` is not, it reaches `lib/kv.ts`.
 *
 * Pure, and in `lib/`, for the reason `lib/start-status.ts` gives. The page
 * holds one `RecoveryState` in a ref and reports what these return.
 */

import type { SetupSource } from "@/lib/loop-stats";
import {
  isPlaylistHelpTopic,
  playlistHelpTopic,
  type PlaylistHelpTopic,
} from "@/lib/playlist-help";

export type RecoveryStage = "refused" | "recovered";

export const RECOVERY_STAGES: readonly RecoveryStage[] = ["refused", "recovered"];

export interface RecoveryState {
  /** What the first permanent refusal on this page was about, or null. */
  refusedWith: PlaylistHelpTopic | null;
  /** Set once a start after it has been reported, so it is counted once. */
  recovered: boolean;
}

export const NO_REFUSAL: RecoveryState = { refusedWith: null, recovered: false };

/**
 * A failure was shown. Returns the topic to report as `refused` the first
 * time a permanent one appears on this page, and null otherwise — a throttled
 * or unknown failure says nothing about the link, and a second refusal on the
 * same page is the same stuck host, not another one.
 */
export function noteFailure(
  state: RecoveryState,
  code: unknown
): { state: RecoveryState; report: PlaylistHelpTopic | null } {
  const topic = playlistHelpTopic(code);
  if (state.refusedWith !== null || topic === null) return { state, report: null };
  return { state: { refusedWith: topic, recovered: false }, report: topic };
}

/**
 * A game started from this page. Returns what to report as `recovered` — the
 * refusal it came back from, and how — or null when nothing was refused here
 * or the recovery was already counted.
 */
export function noteStart(
  state: RecoveryState,
  via: SetupSource
): { state: RecoveryState; report: { topic: PlaylistHelpTopic; via: SetupSource } | null } {
  if (state.refusedWith === null || state.recovered) return { state, report: null };
  return {
    state: { ...state, recovered: true },
    report: { topic: state.refusedWith, via },
  };
}

/**
 * The state carried across a reload of the same tab.
 *
 * Counted per page load until 2026-10-17, and a reload is the ordinary thing
 * to do after changing a playlist's setting in the Spotify app: the host who
 * fixed it and came back counted as a refusal that never recovered, and the
 * reload's own refusal (Spotify still slow to agree) was not counted at all.
 * Per tab, in `sessionStorage`, for `RECOVERY_CARRY_MS` — long enough for an
 * evening's fiddling, short enough that tomorrow's party is a new page.
 */
export const RECOVERY_STORAGE_KEY = "guesssong_refusal";
export const RECOVERY_CARRY_MS = 30 * 60 * 1000;

/**
 * Only an unrecovered refusal is carried. Once a game started after it the
 * episode is over, and carrying it on would hide the next refusal in the same
 * tab — Play Again comes back to `/` in this tab, inside the carry window.
 */
export function serializeRecovery(state: RecoveryState, now = Date.now()): string | null {
  if (state.refusedWith === null || state.recovered) return null;
  return JSON.stringify({ refusedWith: state.refusedWith, at: now });
}

/** Read back field by field; anything off, or older than the carry, is no refusal. */
export function parseRecovery(raw: string | null, now = Date.now()): RecoveryState {
  if (!raw) return NO_REFUSAL;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object") return NO_REFUSAL;
    if (!isPlaylistHelpTopic(value.refusedWith)) return NO_REFUSAL;
    if (typeof value.at !== "number" || now - value.at > RECOVERY_CARRY_MS || value.at > now) {
      return NO_REFUSAL;
    }
    // Never written by serializeRecovery; this guards a hand-edited value.
    if (value.recovered === true) return NO_REFUSAL;
    return { refusedWith: value.refusedWith, recovered: false };
  } catch {
    return NO_REFUSAL;
  }
}
