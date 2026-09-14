/**
 * GET /api/quiz/[code]/board — the owner's results page.
 *
 * Token-gated, unlike the quiz view: this response names every answer. The
 * token rides in the `x-host-token` header, the same way
 * `GET /api/room/[code]/pool` takes the room's — never in the query string,
 * which Vercel's access logs record verbatim. Wrong or missing → 403
 * `quiz_not_host`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getQuizBoard, QuizError } from "@/lib/quiz-store";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import type { QuizBoardResponse } from "@/types/quiz";

const QUIZ_BOARD_LIMIT = 60;
const QUIZ_BOARD_WINDOW_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const token = req.headers.get("x-host-token") ?? "";

  const limited = await enforceRateLimit(
    req,
    "quiz:board",
    QUIZ_BOARD_LIMIT,
    QUIZ_BOARD_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) return limited;

  try {
    const board = await getQuizBoard(code, token);
    return NextResponse.json<QuizBoardResponse>(board, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    if (err instanceof QuizError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    console.error("[quiz] board failed", err);
    return errorResponse("quiz_board_failed", 500);
  }
}
