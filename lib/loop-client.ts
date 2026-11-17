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
import type { PlaylistHelpTopic } from "@/lib/playlist-help";
import type { GameMode, PlaylistKind } from "@/lib/game-session";
import type { OrderPhoneCoverage, OrderPhoneVerdict, OrderVerdict, PlayStyle } from "@/lib/order-game";
import type { GameScored, PlayerBand } from "@/lib/game-players";
import type { Arrival } from "@/lib/arrival";
import type { StarterKey } from "@/lib/starter-playlists";
import type { CountedSetupLocale } from "@/lib/setup-copy";
import type { SoloStep } from "@/lib/solo-party";
import type { DailyDoorStage, MusicAgeOutcome, SoloInviteOutcome } from "@/lib/loop-stats";
import type { BestOutcome, StreakBand } from "@/lib/streak";
import type { ChallengeVerdict } from "@/lib/challenge";
import type { ShareLinkOutcome } from "@/lib/quiz-share";

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
 *
 * `mode` is which game it is (`GameMode`), since 1.21.0: until then KV could
 * not say how many games were buzzer games, let alone order games, and the
 * first-clip line's denominator — "games in which Play could be pressed" —
 * needs the order games taken out of it.
 */
export interface GameStartDetails {
  mixed?: MixedSubMode;
  source?: SetupSource;
  mode?: GameMode;
  players?: PlayerBand;
  from?: Arrival;
  /** Which starter list the game was played from, if the link in the field was one of ours. */
  starter?: StarterKey;
  /** What the link was — the stored payload's `playlistKind`; the server crosses album and artist games only. */
  playlistKind?: PlaylistKind;
  /** A device's first solo game, or its first party after one — `takeSoloStep` in lib/solo-party.ts. */
  soloStep?: SoloStep;
  /** The host split the room into two teams (lib/teams.ts). Sent only when true. */
  teams?: boolean;
  /** A friend's "beat my score" game (lib/challenge.ts). */
  challenge?: true;
  /** The setup page's language, sent only from the Portuguese page (`host_locale:pt`). */
  locale?: CountedSetupLocale;
}

/**
 * One options object rather than a seventh positional optional: the single
 * caller is `recordHostedStart` on the setup page, and a run of `undefined`s
 * to reach the field you mean is how the wrong one gets filed.
 */
export function reportGameStart(hostGameIndex: number, details: GameStartDetails = {}): void {
  const { mixed, source, mode, players, from, starter, playlistKind, soloStep, teams, challenge, locale } = details;
  sendPulse({
    kind: "game_started",
    hostGameIndex,
    ...(mixed ? { mixed } : {}),
    ...(source ? { source } : {}),
    ...(mode ? { mode } : {}),
    ...(players ? { players } : {}),
    // A first game only: the server keys nothing else, so a returning host's
    // beacon carries no referrer-derived field at all.
    ...(from && hostGameIndex === 1 ? { from } : {}),
    ...(starter ? { starter } : {}),
    ...(playlistKind ? { playlistKind } : {}),
    ...(soloStep ? { soloStep } : {}),
    ...(teams === true ? { teams: true as const } : {}),
    ...(challenge ? { challenge } : {}),
    ...(locale ? { locale } : {}),
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
  details: {
    host?: GameHostKind;
    screen?: GameScreen;
    source?: SetupSource;
    mode?: GameMode;
    players?: PlayerBand;
    scored?: GameScored;
    /** The order page's: a card had been moved in the round face down at the end. */
    arranged?: boolean;
    /** Whether this Game Over drew the Mixed link (`gameOverOnward`). */
    linkDrawn?: boolean;
    /** The stored payload's `playlistKind`, so an album's or artist's games can be read by their end. */
    playlistKind?: PlaylistKind;
    /** A game of one only: this device's day streak, banded (`lib/streak.ts`). */
    streak?: StreakBand;
    /** A game of one with a single playlist only: how the score sat against its best. */
    best?: BestOutcome;
    /** A team game (lib/teams.ts). Sent only when true. */
    teams?: boolean;
  } = {}
): void {
  sendPulse({
    kind: "game_finished",
    end,
    roundsPlayed,
    ...(details.host ? { host: details.host } : {}),
    ...(details.screen ? { screen: details.screen } : {}),
    ...(details.source ? { source: details.source } : {}),
    ...(details.mode ? { mode: details.mode } : {}),
    ...(details.players ? { players: details.players } : {}),
    ...(details.scored ? { scored: details.scored } : {}),
    ...(typeof details.arranged === "boolean" ? { arranged: details.arranged } : {}),
    ...(typeof details.linkDrawn === "boolean" ? { linkDrawn: details.linkDrawn } : {}),
    ...(details.playlistKind ? { playlistKind: details.playlistKind } : {}),
    ...(details.streak ? { streak: details.streak } : {}),
    ...(details.best ? { best: details.best } : {}),
    ...(details.teams === true ? { teams: true as const } : {}),
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
  via: "unload" | "navigation",
  source?: SetupSource,
  mode?: GameMode,
  players?: PlayerBand,
  scored?: GameScored,
  arranged?: boolean,
  playlistKind?: PlaylistKind
): void {
  trackEvent("game_left", {
    rounds_played: roundsPlayed,
    host_kind: host,
    via,
    ...(mode ? { game_mode: mode } : {}),
  });
  sendPulse({
    kind: "game_left",
    roundsPlayed,
    host,
    ...(source ? { source } : {}),
    ...(mode ? { mode } : {}),
    ...(players ? { players } : {}),
    ...(scored ? { scored } : {}),
    ...(typeof arranged === "boolean" ? { arranged } : {}),
    ...(playlistKind ? { playlistKind } : {}),
  });
}

/**
 * Call as a "put them in order" round closes after its reveal, with how the
 * host scored it. Both destinations, behind one function, for the reason at
 * the top of this file. Sent from Next Round and from End Game on a revealed
 * round — the document survives both, so this is a beacon like the taps.
 */
export function reportOrderRound(verdict: OrderVerdict, roundIndex: number, arranged?: boolean): void {
  // `arranged` is the host's screen's drag. A round played on the phones
  // passes none: there it is one player's answer among several, and
  // `order_arranged:*` reads the shared screen's.
  trackEvent("order_round_resolved", {
    round_index: roundIndex,
    verdict,
    ...(arranged === undefined ? {} : { arranged }),
  });
  sendPulse(
    arranged === undefined ? { kind: "order_round", verdict } : { kind: "order_round", verdict, arranged }
  );
}

/**
 * Call beside `reportOrderRound` when the round was played on the phones:
 * whether the phones locked in, and how the locked answers graded
 * (lib/order-phone.ts). One beacon per round, the counts inside it, so a
 * room of twelve costs one request and stays far under the pulse body cap.
 */
export function reportOrderPhoneRound(
  roundIndex: number,
  locked: OrderPhoneCoverage,
  counts: Record<OrderPhoneVerdict, number>
): void {
  trackEvent("order_phone_round", { round_index: roundIndex, locked, ...counts });
  sendPulse({ kind: "order_phone", locked, ...counts });
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
  sendPulse({ kind: "game_over_tap", target, ...(screen ? { screen } : {}) });
}

/** Call with what `lib/refusal-recovery.ts` returns to report. */
export function reportRefusal(topic: PlaylistHelpTopic): void {
  trackEvent("refusal_recovery", { stage: "refused", topic });
  sendPulse({ kind: "refusal_recovery", stage: "refused", topic });
}

/** Before `router.push`, like `reportGameStart`, so it can be a beacon. */
export function reportRefusalRecovered(topic: PlaylistHelpTopic, via: SetupSource): void {
  trackEvent("refusal_recovery", { stage: "recovered", topic, via });
  sendPulse({ kind: "refusal_recovery", stage: "recovered", topic, via });
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

/**
 * The solo Game Over's invite card was tapped, and what the share sheet did
 * (`components/solo-invite.tsx`). Its own pair rather than `reportQuizShare`
 * with a new `by`: the quiz's share rows are read as a funnel of their own,
 * and a party invite folded into them would be counted as a quiz nobody made.
 */
export function reportSoloInvite(outcome: SoloInviteOutcome): void {
  trackEvent("solo_invite_tapped", { outcome });
  sendPulse({ kind: "solo_invite", outcome });
}

/**
 * Call when the setup page's "Today's challenge" fake door is first drawn, and
 * on its first tap. See `lib/daily-door.ts`.
 */
export function reportDailyDoor(stage: DailyDoorStage): void {
  trackEvent("daily_door", { stage });
  sendPulse({ kind: "daily_door", stage });
}

/**
 * The order Game Over's music-age card was tapped, and what the share sheet
 * did (`components/music-age.tsx`). Its own pair, not `reportSoloInvite`: the
 * two cards are opposite bets — a result about the player against an
 * invitation — and one counter would average them.
 */
export function reportMusicAge(outcome: MusicAgeOutcome): void {
  trackEvent("music_age_shared", { outcome });
  sendPulse({ kind: "music_age", outcome });
}

/**
 * The setup page drew a "Pick a theme" row for this play style. KV only: the
 * pick is already `starter_key` on GA4's `game_started`, and a per-page
 * impression is the denominator, which KV is authoritative for. The page
 * sends it once per load per style (a ref), never per render.
 */
export function reportStarterThemeRow(style: PlayStyle): void {
  sendPulse({ kind: "starter_theme_row", style });
}

/**
 * A guess-game round was revealed after a lyric line was shown on it
 * (`app/game/page.tsx`, "Read a lyric instead"). Pulse only: the tap's own
 * outcome is counted by `GET /api/lyric` server-side, and this is the one
 * fact only the page has.
 */
export function reportLyricLineRound(): void {
  sendPulse({ kind: "lyric_line_round", outcome: "played" });
}

/**
 * The order Game Over's "beat my score" button was tapped, and what the share
 * sheet did (`components/order-challenge.tsx`). Its own pair, for
 * `reportSoloInvite`'s reason: folded into another surface's rows it would be
 * read as that surface.
 */
export function reportChallengeShare(outcome: ShareLinkOutcome): void {
  trackEvent("challenge_shared", { outcome });
  sendPulse({ kind: "challenge", step: `share:${outcome}` });
}

/** A friend's challenge game reached its Game Over: won, lost or tied. Once per game. */
export function reportChallengeResult(verdict: ChallengeVerdict): void {
  trackEvent("challenge_finished", { verdict });
  sendPulse({ kind: "challenge", step: verdict });
}
