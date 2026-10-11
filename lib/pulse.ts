/**
 * The two facts the browser knows and the server does not.
 *
 * `/r/[surface]` already counts clicks server-side, because a click is a
 * navigation and a navigation reaches the server on its own. These two do not
 * navigate anywhere:
 *
 *   - **impressions** — a loop surface was rendered. The denominator. Without
 *     it "buzz_cta: 12" cannot be read as anything: twelve out of fifteen is a
 *     working call to action, twelve out of nine thousand is a dead one, and
 *     the two demand opposite responses.
 *   - **game starts** — with the host's game index, which is the number the
 *     whole exercise is waiting on. It lives in `localStorage` and no existing
 *     request carries it. Piggybacking it on `POST /api/playlist` looked
 *     cheaper until Mixed mode, which fires one of those per contributor from
 *     a single Start and would multiply every such game by its guest count.
 *   - **game ends** — the other half of the number above. A game that starts
 *     and never reaches Game Over is invisible to every counter on that
 *     screen, and the gap between the two was five thousand games a week
 *     before this existed (`GameEnd` in `lib/loop-stats.ts`).
 *   - **quiz shares** — the owner's or a taker's share button, and what the
 *     sheet said. The step between `quiz:created` and `quiz:opened`, which
 *     was losing most quizzes with no record of how.
 *   - **quiz copies** — the explicit "Copy link" button beside that share
 *     button. Its own event since 2026-09-30, because filed as a share it
 *     made `copied` mean two things (`QuizCopyOutcome` in `lib/loop-stats.ts`).
 *   - **quiz social taps** — a post-to-a-platform link (LINE, X, …), drawn
 *     only where there is no share sheet. Nothing comes back from another
 *     site's tab, so the tap is the whole fact (`recordQuizSocial`).
 *   - **the first clip, a game left, a tap on Game Over** — the three things
 *     the game page knows about a game that did not go well, none of which
 *     is a request: whether the first Play press produced sound, that the
 *     page went away mid-game and at which round, and which way a host who
 *     did finish went next. Two in three games never reached Game Over in
 *     the week to 2026-09-29, and the end beacon above is silent about every
 *     one of them.
 *
 * So: one narrow endpoint, a handful of event shapes, a closed set of values, and
 * nothing that a caller can turn into a key. The parsing lives here rather
 * than in the route so the rejection paths are testable — they are the ones
 * that matter, since the body arrives from the open internet.
 */

import { isLoopSurface, type LoopSurface } from "@/lib/loop-links";
import {
  FIRST_CLIP_OUTCOMES,
  FIRST_CLIP_PATHS,
  GAME_ENDS,
  GAME_HOST_KINDS,
  GAME_OVER_TAPS,
  MIXED_NUDGE_STAGES,
  REMOTE_DOOR_STAGES,
  GAME_ROUND_CEILING,
  GAME_ROUND_FLOOR,
  GAME_SCREENS,
  HOST_INDEX_CEILING,
  MIXED_SUB_MODES,
  QUIZ_SHARE_BYS,
  QUIZ_SHARE_OUTCOMES,
  type FirstClipOutcome,
  type FirstClipPath,
  type GameEnd,
  type GameHostKind,
  type GameOverTap,
  type MixedNudgeStage,
  type RemoteDoorStage,
  type GameScreen,
  type MixedSubMode,
  type QuizShareBy,
  type QuizShareOutcome,
} from "@/lib/loop-stats";
// A statement of its own rather than two more names in the list above: that
// list is the one line of this file every new event has to touch.
import { QUIZ_COPY_OUTCOMES, type QuizCopyOutcome } from "@/lib/loop-stats";
import { isSetupSource, type SetupSource } from "@/lib/setup-source";
import { isSocialPlatform, type SocialPlatform } from "@/lib/social-share";
import { isPlaylistHelpTopic, type PlaylistHelpTopic } from "@/lib/playlist-help";
import { isGameMode, type GameMode } from "@/lib/game-session";
import { isOrderVerdict, type OrderVerdict } from "@/lib/order-game";
import { isGameScored, isPlayerBand, type GameScored, type PlayerBand } from "@/lib/game-players";

function isMixedSubMode(value: unknown): value is MixedSubMode {
  return typeof value === "string" && (MIXED_SUB_MODES as readonly string[]).includes(value);
}

function isGameEnd(value: unknown): value is GameEnd {
  return typeof value === "string" && (GAME_ENDS as readonly string[]).includes(value);
}

function isGameHostKind(value: unknown): value is GameHostKind {
  return typeof value === "string" && (GAME_HOST_KINDS as readonly string[]).includes(value);
}

function isGameScreen(value: unknown): value is GameScreen {
  return typeof value === "string" && (GAME_SCREENS as readonly string[]).includes(value);
}

function isFirstClipPath(value: unknown): value is FirstClipPath {
  return typeof value === "string" && (FIRST_CLIP_PATHS as readonly string[]).includes(value);
}

function isFirstClipOutcome(value: unknown): value is FirstClipOutcome {
  return (
    typeof value === "string" && (FIRST_CLIP_OUTCOMES as readonly string[]).includes(value)
  );
}

function isGameOverTap(value: unknown): value is GameOverTap {
  return typeof value === "string" && (GAME_OVER_TAPS as readonly string[]).includes(value);
}

function isMixedNudgeStage(value: unknown): value is MixedNudgeStage {
  return typeof value === "string" && (MIXED_NUDGE_STAGES as readonly string[]).includes(value);
}

function isRemoteDoorStage(value: unknown): value is RemoteDoorStage {
  return typeof value === "string" && (REMOTE_DOOR_STAGES as readonly string[]).includes(value);
}

/**
 * A round off the wire, or null when it is not a number at all.
 *
 * Clamped between the floor and the ceiling like the host index, and for its
 * reason. The floor is zero and zero is let through: it is what
 * `countRoundsPlayed` sends for a game that ended before any clip started,
 * and clamping it up to 1 — which this did until 2026-09-30 — filed every
 * game that never played under "ended at round one".
 */
function parseRound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(GAME_ROUND_FLOOR, Math.min(Math.trunc(value), GAME_ROUND_CEILING));
}

function isQuizShareBy(value: unknown): value is QuizShareBy {
  return typeof value === "string" && (QUIZ_SHARE_BYS as readonly string[]).includes(value);
}

function isQuizShareOutcome(value: unknown): value is QuizShareOutcome {
  return (
    typeof value === "string" && (QUIZ_SHARE_OUTCOMES as readonly string[]).includes(value)
  );
}

function isQuizCopyOutcome(value: unknown): value is QuizCopyOutcome {
  return (
    typeof value === "string" && (QUIZ_COPY_OUTCOMES as readonly string[]).includes(value)
  );
}

export type PulseEvent =
  | { kind: "loop_impression"; surface: LoopSurface }
  | {
      kind: "game_started";
      hostGameIndex: number;
      mixed?: MixedSubMode;
      source?: SetupSource;
      mode?: GameMode;
      players?: PlayerBand;
    }
  | {
      kind: "game_finished";
      end: GameEnd;
      roundsPlayed: number;
      host?: GameHostKind;
      screen?: GameScreen;
      source?: SetupSource;
      mode?: GameMode;
      players?: PlayerBand;
      scored?: GameScored;
    }
  | { kind: "first_clip"; path: FirstClipPath; outcome: FirstClipOutcome }
  | {
      kind: "game_left";
      roundsPlayed: number;
      host?: GameHostKind;
      source?: SetupSource;
      mode?: GameMode;
      players?: PlayerBand;
      scored?: GameScored;
    }
  | { kind: "order_round"; verdict: OrderVerdict }
  | { kind: "game_over_tap"; target: GameOverTap }
  | { kind: "mixed_nudge"; stage: MixedNudgeStage }
  | { kind: "remote_door"; stage: RemoteDoorStage }
  | { kind: "refusal_recovery"; stage: "refused"; topic: PlaylistHelpTopic }
  | { kind: "refusal_recovery"; stage: "recovered"; topic: PlaylistHelpTopic; via: SetupSource }
  | { kind: "quiz_copied"; by: QuizShareBy; outcome: QuizCopyOutcome }
  | { kind: "quiz_shared"; by: QuizShareBy; outcome: QuizShareOutcome }
  | { kind: "quiz_social"; by: QuizShareBy; platform: SocialPlatform };

/**
 * Narrows an untrusted request body, or returns null.
 *
 * Every field is checked rather than cast. This endpoint is unauthenticated by
 * necessity — the people it measures have no accounts — so the body is exactly
 * as trustworthy as a query string, and one of these values becomes part of a
 * KV key. An unbounded string reaching that key is how a counter namespace
 * turns into a bill.
 */
export function parsePulse(body: unknown): PulseEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  if (raw.kind === "loop_impression") {
    return isLoopSurface(raw.surface)
      ? { kind: "loop_impression", surface: raw.surface }
      : null;
  }

  if (raw.kind === "game_started") {
    const index = raw.hostGameIndex;
    if (typeof index !== "number" || !Number.isFinite(index)) return null;
    // Clamped here as well as in lib/loop-stats.ts. The store clamps because
    // it owns the key space; this clamps because a body claiming 1e308 should
    // never have been accepted in the first place, and rejecting it outright
    // would drop a real game over a corrupted counter.
    const clamped = Math.max(1, Math.min(Math.trunc(index), HOST_INDEX_CEILING));
    // Dropped rather than rejected when it is not one of the two known values,
    // for the same reason the index above is clamped rather than rejected: the
    // game is real either way, and losing the sub-mode costs one row of detail
    // while losing the game costs the only number anyone reads. An unrecognised
    // string must never survive to `mixed_pool:${value}` — that is the field
    // that becomes a KV key.
    const started: Extract<PulseEvent, { kind: "game_started" }> = isMixedSubMode(raw.mixed)
      ? { kind: "game_started", hostGameIndex: clamped, mixed: raw.mixed }
      : { kind: "game_started", hostGameIndex: clamped };
    // The same trade for how the playlist got into the field, and the same
    // hazard: `host_setup:${value}` is a key. Absent is the ordinary case for
    // a while — every page loaded before this shipped sends none — and must
    // parse exactly as it always did.
    const sourced = isSetupSource(raw.source) ? { ...started, source: raw.source } : started;
    // And once more for which game it was: `game_mode:${value}` is a key, a
    // page from before 1.21.0 sends none, and a game with an unknown mode is
    // still a game.
    const moded = isGameMode(raw.mode) ? { ...sourced, mode: raw.mode } : sourced;
    // And the scoreboard's band, under the same trade: `game_players:${value}`
    // is a key, and an older page sends none.
    return isPlayerBand(raw.players) ? { ...moded, players: raw.players } : moded;
  }

  if (raw.kind === "game_finished") {
    // The end is a key tail and is rejected when unknown; the round is
    // clamped like the index above, and for the same reason — a corrupted
    // counter must not cost the game its place in the "reached the end" total.
    if (!isGameEnd(raw.end)) return null;
    const clamped = parseRound(raw.roundsPlayed);
    if (clamped === null) return null;
    // The host kind and the screen are dropped when unknown, not rejected —
    // the `mixed` rule above, for its reason: a page from before 2026-09-30
    // sends neither and its game ended all the same. Neither may survive as
    // anything but a member of its list; both become key tails.
    return {
      kind: "game_finished",
      end: raw.end,
      roundsPlayed: clamped,
      ...(isGameHostKind(raw.host) ? { host: raw.host } : {}),
      ...(isGameScreen(raw.screen) ? { screen: raw.screen } : {}),
      // How the playlist got into the field, carried from `game_started` on
      // the stored payload. Same trade: a game stored before 2026-10-05 has
      // none, and `game_end_source:${value}` is a key.
      ...(isSetupSource(raw.source) ? { source: raw.source } : {}),
      // Which game it was. `game_end_mode:${value}:${end}` is a key.
      ...(isGameMode(raw.mode) ? { mode: raw.mode } : {}),
      // How many it was for, and whether anyone scored. Both are keys.
      ...(isPlayerBand(raw.players) ? { players: raw.players } : {}),
      ...(isGameScored(raw.scored) ? { scored: raw.scored } : {}),
    };
  }

  if (raw.kind === "first_clip") {
    // Both halves are key tails and neither has a fallback: a first clip
    // that cannot say which path it took, or how it came out, is not a
    // reading of anything.
    if (!isFirstClipPath(raw.path) || !isFirstClipOutcome(raw.outcome)) return null;
    return { kind: "first_clip", path: raw.path, outcome: raw.outcome };
  }

  if (raw.kind === "game_left") {
    const clamped = parseRound(raw.roundsPlayed);
    if (clamped === null) return null;
    return {
      kind: "game_left",
      roundsPlayed: clamped,
      ...(isGameHostKind(raw.host) ? { host: raw.host } : {}),
      ...(isSetupSource(raw.source) ? { source: raw.source } : {}),
      ...(isGameMode(raw.mode) ? { mode: raw.mode } : {}),
      ...(isPlayerBand(raw.players) ? { players: raw.players } : {}),
      ...(isGameScored(raw.scored) ? { scored: raw.scored } : {}),
    };
  }

  if (raw.kind === "order_round") {
    // The verdict is the whole event and a key tail; an undeclared one is
    // refused, never filed under a neighbour.
    return isOrderVerdict(raw.verdict) ? { kind: "order_round", verdict: raw.verdict } : null;
  }

  if (raw.kind === "game_over_tap") {
    return isGameOverTap(raw.target) ? { kind: "game_over_tap", target: raw.target } : null;
  }

  if (raw.kind === "refusal_recovery") {
    // Both tails closed; a recovery without a valid `via` says nothing about
    // how the host got past the refusal, so it is dropped, not half-kept.
    if (!isPlaylistHelpTopic(raw.topic)) return null;
    if (raw.stage === "refused") return { kind: "refusal_recovery", stage: "refused", topic: raw.topic };
    if (raw.stage === "recovered" && isSetupSource(raw.via)) {
      return { kind: "refusal_recovery", stage: "recovered", topic: raw.topic, via: raw.via };
    }
    return null;
  }

  if (raw.kind === "mixed_nudge") {
    return isMixedNudgeStage(raw.stage) ? { kind: "mixed_nudge", stage: raw.stage } : null;
  }

  if (raw.kind === "remote_door") {
    return isRemoteDoorStage(raw.stage) ? { kind: "remote_door", stage: raw.stage } : null;
  }

  if (raw.kind === "quiz_shared") {
    // Both fields become key tails; neither has a "keep the event anyway"
    // fallback, because an event with either half missing says nothing.
    if (!isQuizShareBy(raw.by) || !isQuizShareOutcome(raw.outcome)) return null;
    return { kind: "quiz_shared", by: raw.by, outcome: raw.outcome };
  }

  if (raw.kind === "quiz_copied") {
    // The share event's rule, with the narrower outcome list: a copy that
    // claims `shared` or `dismissed` is not a copy, and accepting it would
    // put the two-meanings problem back one key over.
    if (!isQuizShareBy(raw.by) || !isQuizCopyOutcome(raw.outcome)) return null;
    return { kind: "quiz_copied", by: raw.by, outcome: raw.outcome };
  }

  if (raw.kind === "quiz_social") {
    // Both fields are key tails. An undeclared platform is refused, not
    // filed under a neighbour: a tap on a link nobody rendered is not data.
    if (!isQuizShareBy(raw.by) || !isSocialPlatform(raw.platform)) return null;
    return { kind: "quiz_social", by: raw.by, platform: raw.platform };
  }

  return null;
}
