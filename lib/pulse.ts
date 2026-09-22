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
 *
 * So: one narrow endpoint, four event shapes, a closed set of values, and
 * nothing that a caller can turn into a key. The parsing lives here rather
 * than in the route so the rejection paths are testable — they are the ones
 * that matter, since the body arrives from the open internet.
 */

import { isLoopSurface, type LoopSurface } from "@/lib/loop-links";
import {
  GAME_ENDS,
  GAME_ROUND_CEILING,
  HOST_INDEX_CEILING,
  MIXED_SUB_MODES,
  QUIZ_SHARE_BYS,
  QUIZ_SHARE_OUTCOMES,
  type GameEnd,
  type MixedSubMode,
  type QuizShareBy,
  type QuizShareOutcome,
} from "@/lib/loop-stats";

function isMixedSubMode(value: unknown): value is MixedSubMode {
  return typeof value === "string" && (MIXED_SUB_MODES as readonly string[]).includes(value);
}

function isGameEnd(value: unknown): value is GameEnd {
  return typeof value === "string" && (GAME_ENDS as readonly string[]).includes(value);
}

function isQuizShareBy(value: unknown): value is QuizShareBy {
  return typeof value === "string" && (QUIZ_SHARE_BYS as readonly string[]).includes(value);
}

function isQuizShareOutcome(value: unknown): value is QuizShareOutcome {
  return (
    typeof value === "string" && (QUIZ_SHARE_OUTCOMES as readonly string[]).includes(value)
  );
}

export type PulseEvent =
  | { kind: "loop_impression"; surface: LoopSurface }
  | { kind: "game_started"; hostGameIndex: number; mixed?: MixedSubMode }
  | { kind: "game_finished"; end: GameEnd; roundsPlayed: number }
  | { kind: "quiz_shared"; by: QuizShareBy; outcome: QuizShareOutcome };

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
    return isMixedSubMode(raw.mixed)
      ? { kind: "game_started", hostGameIndex: clamped, mixed: raw.mixed }
      : { kind: "game_started", hostGameIndex: clamped };
  }

  if (raw.kind === "game_finished") {
    // The end is a key tail and is rejected when unknown; the round is
    // clamped like the index above, and for the same reason — a corrupted
    // counter must not cost the game its place in the "reached the end" total.
    if (!isGameEnd(raw.end)) return null;
    const rounds = raw.roundsPlayed;
    if (typeof rounds !== "number" || !Number.isFinite(rounds)) return null;
    const clamped = Math.max(1, Math.min(Math.trunc(rounds), GAME_ROUND_CEILING));
    return { kind: "game_finished", end: raw.end, roundsPlayed: clamped };
  }

  if (raw.kind === "quiz_shared") {
    // Both fields become key tails; neither has a "keep the event anyway"
    // fallback, because an event with either half missing says nothing.
    if (!isQuizShareBy(raw.by) || !isQuizShareOutcome(raw.outcome)) return null;
    return { kind: "quiz_shared", by: raw.by, outcome: raw.outcome };
  }

  return null;
}
