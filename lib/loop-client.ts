/**
 * What a loop surface does when it is shown and when it is followed.
 *
 * Two destinations, because they answer different questions and fail in
 * different ways:
 *
 *   - **GA4** — cohorting, sessions, the questions nobody has asked yet. Dies
 *     to an ad blocker.
 *   - **KV, via `/api/pulse` and `/r/[surface]`** — the numbers `npm run stats`
 *     prints without anyone opening a dashboard. Dies to a spent rate-limit
 *     window.
 *
 * Neither is a superset. KV is authoritative; the gap between the two is itself
 * a reading of how much of this audience blocks analytics.
 *
 * Keeping both calls behind one function is the point: two call sites per
 * surface would drift, and the drift is silent — one number keeps moving, the
 * other quietly stops.
 */

import { trackEvent } from "@/lib/analytics";
import type { LoopSurface } from "@/lib/loop-links";
import type { MixedSubMode } from "@/lib/loop-stats";
import { sendPulse } from "@/lib/pulse-client";

const SEEN_PREFIX = "guesssong_loop_seen:";

/**
 * Once per surface per tab.
 *
 * `room_join_opened` fires on every page load and CHANGELOG.md:34 already
 * records what that costs: a phone that drops Wi-Fi and reloads counts twice,
 * so the denominator inflates and every rate built on it reads low. A player
 * who reloads the buzzer page mid-party has not been shown the call to action
 * a second time in any sense that matters.
 *
 * Session-scoped rather than device-scoped on purpose: the next party is a new
 * session and genuinely is a new impression.
 */
function firstTimeThisSession(surface: LoopSurface): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = `${SEEN_PREFIX}${surface}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    // Storage blocked: count it. Over-counting an impression understates the
    // click rate, which is the safe direction — it cannot manufacture a
    // success that did not happen.
    return true;
  }
}

/** Call when a loop surface becomes visible. Safe to call on every render. */
export function reportLoopImpression(surface: LoopSurface): void {
  if (!firstTimeThisSession(surface)) return;
  trackEvent("loop_surface_shown", { surface });
  sendPulse({ kind: "loop_impression", surface });
}

/**
 * Call from the click handler on a loop link.
 *
 * Only GA4 here. The KV side is counted by `/r/[surface]` when the browser
 * follows the link, which is why the link is a real navigation and not a
 * background request: the navigation cannot be cancelled the way an in-flight
 * `fetch` can, and this is the one number the whole feature is judged on.
 */
export function reportLoopClick(surface: LoopSurface): void {
  trackEvent("player_to_host_click", { surface });
}

/**
 * Call as a hosted game starts, with the device's 1-based game index and, for
 * Mixed Playlist Mode, which route collected the playlists.
 *
 * Sent as a beacon because the caller navigates to `/game` immediately after.
 * GA4 gets the same numbers as params on `game_started`; this is the copy
 * `npm run stats` can read.
 *
 * `mixed` is omitted rather than sent as a sentinel on a single-playlist game,
 * so the field's presence is the whole signal and nothing has to agree on what
 * "none" is called.
 */
export function reportGameStart(hostGameIndex: number, mixed?: MixedSubMode): void {
  sendPulse(mixed ? { kind: "game_started", hostGameIndex, mixed } : { kind: "game_started", hostGameIndex });
}
