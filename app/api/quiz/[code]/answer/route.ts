/**
 * POST /api/quiz/[code]/answer — grade one taker and put them on the board.
 *
 * Grading happens here and nowhere else: the key never left the server, so
 * the score on the board is one the owner can believe.
 *
 * A sheet carrying the quiz's host token is the owner's preview: graded the
 * same way, answered with `preview` set, and never written
 * (`submitQuizAnswers`). It counts `quiz:owner_completed` and none of the
 * three a friend's sheet does, so the verdict spread and the length table
 * stay a reading of the people the quiz was sent to.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitQuizAnswers, QuizError } from "@/lib/quiz-store";
import { recordQuizCompleted, recordQuizOwnerStage, recordQuizThrottled } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import {
  QUIZ_HOST_TOKEN_HEADER,
  QUIZ_MAX_QUESTIONS,
  QUIZ_NAME_MAX,
  type AnswerQuizResponse,
} from "@/types/quiz";

/**
 * Sized to the read limit, not below it. A quiz link is opened by a group
 * chat, and a class or an office is one egress address: with reads at 60 and
 * answers at 20, the 21st finisher was bounced back to the name card after
 * answering every question. The store's `hsetnx` and the 50-row cap already
 * bound what one address can write.
 */
const QUIZ_ANSWER_LIMIT = 60;
const QUIZ_ANSWER_WINDOW_SECONDS = 10 * 60;

/**
 * `name` may be empty here and is still required of everyone but the owner.
 * The owner's preview writes no row, so it has nothing to name — but whether
 * a request *is* the owner's is the store's to say, after the one read, and
 * this schema runs before it. So the floor moved out of the schema and into
 * the two places below that can each see half of it: no name and no token is
 * the same 400 it always was, decided here; no name and a token that turns
 * out not to be this quiz's is the store's `quiz_name_required`.
 */
const AnswerSchema = z.object({
  name: z.string().trim().max(QUIZ_NAME_MAX),
  answers: z.array(z.number().int()).max(QUIZ_MAX_QUESTIONS),
  hintsUsed: z.number().int().optional(),
  submissionId: z.string().min(1).max(64).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const token = req.headers.get(QUIZ_HOST_TOKEN_HEADER);

  const limited = await enforceRateLimit(
    req,
    "quiz:answer",
    QUIZ_ANSWER_LIMIT,
    QUIZ_ANSWER_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) {
    // The refusal the 20-per-window limit used to hand the 21st finisher.
    // Counted so a low completion rate can be told apart from a tight limit.
    await recordQuizThrottled("answer");
    return limited;
  }

  let body: z.infer<typeof AnswerSchema>;
  try {
    body = AnswerSchema.parse(await req.json());
  } catch {
    return errorResponse("quiz_missing_fields", 400);
  }
  if (!body.name && !token) return errorResponse("quiz_missing_fields", 400);

  try {
    const result = await submitQuizAnswers(
      code,
      body.name,
      body.answers,
      body.hintsUsed,
      body.submissionId,
      token
    );
    const { replayed, ...response } = result;
    if (response.preview) {
      // Instead of, not as well as: see `QuizOwnerStage`.
      await recordQuizOwnerStage("owner_completed");
    } else if (!replayed) {
      // Three independent, fail-soft counters in one round trip, not in series
      // on the response the taker is waiting for. Not for a replay: that is a
      // finish already counted, seen again (`SubmittedAnswers`).
      await recordQuizCompleted({ questionCount: response.total, verdict: response.verdict });
    }
    return NextResponse.json<AnswerQuizResponse>(response);
  } catch (err: unknown) {
    if (err instanceof QuizError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    console.error("[quiz] answer failed", err);
    return errorResponse("quiz_answer_failed", 500);
  }
}
