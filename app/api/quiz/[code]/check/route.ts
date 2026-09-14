/**
 * POST /api/quiz/[code]/check — the answer to one question, the moment it
 * is answered.
 *
 * The page shows right or wrong per tap and the key still never leaves the
 * server unasked: this answers for question N only against a pick for N,
 * and the page locks the question before it asks. It hands back the answer
 * alone; right or wrong is the page's comparison, which it has to make
 * anyway for a question restored from storage. Grading and the board are
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
import type { CheckQuizResponse } from "@/types/quiz";

const QUIZ_CHECK_LIMIT = 600;
const QUIZ_CHECK_WINDOW_SECONDS = 10 * 60;

/**
 * Shape only — an integer each — like `answer/route.ts`'s sheet. Range is
 * the store's call (`checkQuizAnswer`), so an out-of-range question or pick
 * gets the same 422 `quiz_invalid_answers` a sheet with one in it gets;
 * `quiz_missing_fields` stays what a missing field or a non-JSON body is.
 */
const CheckSchema = z.object({
  q: z.number().int(),
  pick: z.number().int(),
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
