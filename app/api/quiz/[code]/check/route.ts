/**
 * POST /api/quiz/[code]/check — the verdict on one question, the moment it
 * is answered.
 *
 * The page shows right or wrong per tap and the key still never leaves the
 * server unasked: this answers for question N only against a pick for N,
 * and the page locks the question before it asks. Grading and the board are
 * unchanged — `POST …/answer` still writes the row from the sheet the page
 * kept; `checkQuizAnswer` in lib/quiz-store.ts says what that does and does
 * not protect.
 *
 * One request per question rather than one per taker, so the limit is sized
 * to a room of phones behind one address finishing a long quiz inside the
 * window, not to the read limit: 600 is twelve takers through fifty
 * questions, or thirty through twenty. A refusal costs the taker a verdict,
 * not the question — the page advances without one — which is exactly the
 * kind of failure nobody reports, so it is counted.
 *
 * `q === 0` is also the funnel's `started`: the first half tapped, once per
 * attempt. See `QuizStage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkQuizAnswer, QuizError } from "@/lib/quiz-store";
import { recordQuizStage, recordQuizThrottled } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import { QUIZ_MAX_QUESTIONS, QUIZ_OPTION_COUNT, type CheckQuizResponse } from "@/types/quiz";

const QUIZ_CHECK_LIMIT = 600;
const QUIZ_CHECK_WINDOW_SECONDS = 10 * 60;

/** The same bounds `isAnswerList` puts on a sheet; the store re-checks against the quiz itself. */
const CheckSchema = z.object({
  q: z.number().int().min(0).max(QUIZ_MAX_QUESTIONS - 1),
  pick: z.number().int().min(0).max(QUIZ_OPTION_COUNT - 1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const limited = await enforceRateLimit(
    req,
    "quiz:check",
    QUIZ_CHECK_LIMIT,
    QUIZ_CHECK_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) {
    await recordQuizThrottled("check");
    return limited;
  }

  let body: z.infer<typeof CheckSchema>;
  try {
    body = CheckSchema.parse(await req.json());
  } catch {
    return errorResponse("quiz_missing_fields", 400);
  }

  try {
    const result = await checkQuizAnswer(code, body.q, body.pick);
    if (body.q === 0) await recordQuizStage("started");
    return NextResponse.json<CheckQuizResponse>(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    if (err instanceof QuizError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    console.error("[quiz] check failed", err);
    return errorResponse("server_error", 500);
  }
}
