/**
 * GET /api/quiz/[code] — the quiz as a taker sees it: questions without the
 * key, and the board so far.
 *
 * This, and not the page's `generateMetadata`, is where an open is counted.
 * The metadata is fetched by every chat app that unfurls the link; this is
 * fetched by the page's own script, i.e. by a phone that actually rendered it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getQuizView, QuizError } from "@/lib/quiz-store";
import { recordQuizStage } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import type { QuizView } from "@/types/quiz";

const QUIZ_READ_LIMIT = 60;
const QUIZ_READ_WINDOW_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Keyed by IP only, so sweeping codes from one address is throttled as a
  // whole rather than per code.
  const limited = await enforceRateLimit(
    req,
    "quiz:read",
    QUIZ_READ_LIMIT,
    QUIZ_READ_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) return limited;

  try {
    const view = await getQuizView(code);
    await recordQuizStage("opened");
    return NextResponse.json<QuizView>(view, {
      // A board that changes as friends finish must not be cached along the way.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    if (err instanceof QuizError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    console.error("[quiz] load failed", err);
    return errorResponse("quiz_load_failed", 500);
  }
}
