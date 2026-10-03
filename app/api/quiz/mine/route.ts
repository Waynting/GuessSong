/**
 * POST /api/quiz/mine — the owner's dashboard: every quiz this device made.
 *
 * The device sends what it holds — up to `QUIZ_MINE_MAX` `{code, token}`
 * pairs from `lib/quiz-session.ts` — and gets back one summary per quiz.
 * There is no account, so the tokens *are* the login, and that is why this is
 * a POST with them in the body rather than a GET with them in the query
 * string, which access logs keep. Each token is checked against its own quiz
 * (`getQuizSummaries`); a wrong one is that row's `not_host`, not a 403 for
 * the whole page.
 *
 * Nothing here names an answer — the summaries are what the public ranking
 * on `/q/<code>` shows anyone — so it carries no more than the board does
 * and less. Counted once per fetch as `quiz:owner_dashboard`, a ceiling like
 * `quiz:board`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getQuizSummaries } from "@/lib/quiz-store";
import { recordQuizOwnerStage, recordQuizThrottled } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import { QUIZ_MINE_MAX, type QuizMineResponse } from "@/types/quiz";

/**
 * Each request is up to ten `hgetall`s, so this sits at half the board's
 * ceiling: the page fetches on open, on Refresh and when the tab comes back,
 * never on a timer.
 */
const QUIZ_MINE_LIMIT = 30;
const QUIZ_MINE_WINDOW_SECONDS = 10 * 60;

const MineSchema = z.object({
  quizzes: z
    .array(
      z.object({
        // Shape is checked by the store before any KV command; this only
        // bounds what a body can make the route hold.
        code: z.string().max(16),
        token: z.string().max(128),
      })
    )
    .max(QUIZ_MINE_MAX),
});

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "quiz:mine",
    QUIZ_MINE_LIMIT,
    QUIZ_MINE_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) {
    await recordQuizThrottled("mine");
    return limited;
  }

  let body: z.infer<typeof MineSchema>;
  try {
    body = MineSchema.parse(await req.json());
  } catch {
    return errorResponse("quiz_board_failed", 400);
  }

  try {
    const quizzes = await getQuizSummaries(body.quizzes);
    // Only when there was something to show: an empty device asking is not
    // an owner coming back.
    if (quizzes.some((q) => q.status === "ok")) {
      await recordQuizOwnerStage("owner_dashboard");
    }
    return NextResponse.json<QuizMineResponse>(
      { quizzes },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    console.error("[quiz] dashboard failed", err);
    return errorResponse("quiz_board_failed", 500);
  }
}
