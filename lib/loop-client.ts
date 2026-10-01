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
import type { GameEnd, MixedSubMode, QuizShareBy, QuizShareOutcome } from "@/lib/loop-stats";
import type { QuizCopyOutcome } from "@/lib/loop-stats";
import type { SocialPlatform } from "@/lib/social-share";
import type { SetupSource } from "@/lib/loop-stats";
import type {
  FirstClipOutcome,
  FirstClipPath,
  GameHostKind,
  GameOverTap,
  GameScreen,
} from "@/lib/loop-stats";
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
 *
 * `source` is how the playlist got into the field (`SetupSource` in
 * `lib/loop-stats.ts`). Optional for the same reason: a caller that does not
 * know sends nothing, and the game is counted as it always was.
 */
export function reportGameStart(
  hostGameIndex: number,
  mixed?: MixedSubMode,
  source?: SetupSource
): void {
  sendPulse({
    kind: "game_started",
    hostGameIndex,
    ...(mixed ? { mixed } : {}),
    ...(source ? { source } : {}),
  });
}

/**
 * Call once as a game reaches its Game Over screen — from the same guard
 * that fires GA4's `game_finished`, so the two cannot disagree about whether
 * a game ended. GA4 keeps the richer params (duration, mode, phones); this
 * is the copy `npm run stats` can subtract from `Games started`.
 *
 * `roundsPlayed` is `countRoundsPlayed`'s figure, the one GA4 gets.
 *
 * `details` joins the end to the two things the day totals could not: whether
 * this device had hosted before, and which layout drew the Game Over screen.
 * Spread rather than passed, so a caller that has neither sends the body an
 * older page would have — the server counts that one exactly as it always did.
 */
export function reportGameEnd(
  end: GameEnd,
  roundsPlayed: number,
  details: { host?: GameHostKind; screen?: GameScreen } = {}
): void {
  sendPulse({
    kind: "game_finished",
    end,
    roundsPlayed,
    ...(details.host ? { host: details.host } : {}),
    ...(details.screen ? { screen: details.screen } : {}),
  });
}

/**
 * Call once per game page, when the first Play press has come out one way or
 * another. `createFirstClipTracker` in `lib/first-clip.ts` is what makes it
 * once; this only sends. Both destinations, for the reason at the top of this
 * file.
 */
export function reportFirstClip(path: FirstClipPath, outcome: FirstClipOutcome): void {
  trackEvent("first_clip", { path, outcome });
  sendPulse({ kind: "first_clip", path, outcome });
}

/**
 * Call as the game page goes away with the game unfinished.
 *
 * On `pagehide` this is the last thing the document does, which is the case
 * `sendPulse` is a beacon for. `via` is GA4's alone — `unload` is the
 * document going (a closed tab, a reload), `navigation` is the page being
 * unmounted with the document still alive (the back gesture) — because the
 * two are one fact to the histogram and two to anyone asking which it was.
 */
export function reportGameLeft(
  roundsPlayed: number,
  host: GameHostKind,
  via: "unload" | "navigation"
): void {
  trackEvent("game_left", { rounds_played: roundsPlayed, host_kind: host, via });
  sendPulse({ kind: "game_left", roundsPlayed, host });
}

/**
 * Call from a tap on the Game Over screen, before the navigation it causes.
 *
 * A loop link must be a real navigation because the click tears its document
 * down (`reportLoopClick`, above). These two do not: both are `router.push`,
 * the document survives, and the beacon was handed to the browser before the
 * route changed.
 */
export function reportGameOverTap(target: GameOverTap, screen: GameScreen | null): void {
  trackEvent("game_over_tap", screen ? { target, screen } : { target });
  sendPulse({ kind: "game_over_tap", target });
}

/**
 * Call from a quiz's share button once the sheet has answered. Both
 * destinations, behind one function, for the reason at the top of this file:
 * `quiz_share_tapped` had been GA4-only, and a 0.6-opens-per-quiz reading sat
 * unexplained for a week because the number that explained it was on the
 * side nobody opens.
 */
export function reportQuizShare(by: QuizShareBy, outcome: QuizShareOutcome): void {
  trackEvent("quiz_share_tapped", { by, outcome });
  sendPulse({ kind: "quiz_shared", by, outcome });
}

/**
 * Call from an explicit "Copy link" button once the clipboard has answered.
 *
 * Its own function, event and key, and that separation is the point: until
 * 2026-09-30 the panel's Copy button and its share button both ended in
 * `reportQuizShare("owner", …)`, so `copied` was the share sheet's fallback
 * and a deliberate Copy tap added together. A Copy handler that calls
 * `reportQuizShare` again — it type-checks, `copied` and `failed` are both
 * share outcomes — puts that back, silently.
 */
export function reportQuizCopy(by: QuizShareBy, outcome: QuizCopyOutcome): void {
  trackEvent("quiz_copy_tapped", { by, outcome });
  sendPulse({ kind: "quiz_copied", by, outcome });
}

/**
 * Call from a tap on a post-to-a-platform link, as the click happens.
 *
 * The link opens in a new tab (`target="_blank"`), so this document survives
 * the click and the beacon is not racing a teardown — the reason the loop
 * links must be real navigations does not apply. Its own function, event and
 * key for the reason `reportQuizCopy` gives: a third button folded into
 * either neighbour's counter is a number that means two things.
 */
export function reportQuizSocial(by: QuizShareBy, platform: SocialPlatform): void {
  trackEvent("quiz_social_tapped", { by, platform });
  sendPulse({ kind: "quiz_social", by, platform });
}
