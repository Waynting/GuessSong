/**
 * GET /api/quiz/[code] — the quiz as a taker sees it: questions without the
 * key, and the board so far.
 *
 * This, and not the page's `generateMetadata`, is where an open is counted.
 * The metadata is fetched by every chat app that unfurls the link; this is
 * fetched by the page's own script, i.e. by a phone that actually rendered it.
 *
 * ## Which counter, and whether any
 *
 * One successful read bumps exactly one of three things:
 *
 *   quiz:opened         anyone who is not provably the owner
 *   quiz:owner_opened   a request carrying this quiz's host token
 *   nothing             `?refetch=1` — the page re-reading a view it already
 *                       counted, for the result screen's Refresh
 *
 * Both signals are read so that not recognising them is the old behaviour.
 * The refetch flag is compared against exactly `"1"`; anything else is a real
 * open, which is what a page from before 2026-09-30 sends. A missing or wrong
 * token is an ordinary taker — never a 403, which is the board's answer to
 * the same token and would turn a friend's stale storage into a dead link.
 * And neither changes the reply beyond the view's own `owner` mark: the flag
 * decides what is counted, not what is returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { getQuizView, QuizError } from "@/lib/quiz-store";
import { recordQuizOwnerStage, recordQuizStage, recordQuizThrottled } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import { QUIZ_HOST_TOKEN_HEADER, QUIZ_REFETCH_PARAM, type QuizView } from "@/types/quiz";

const QUIZ_READ_LIMIT = 60;
const QUIZ_READ_WINDOW_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const token = req.headers.get(QUIZ_HOST_TOKEN_HEADER);
  const refetch = req.nextUrl.searchParams.get(QUIZ_REFETCH_PARAM) === "1";

  // Keyed by IP only, so sweeping codes from one address is throttled as a
  // whole rather than per code. A refetch is limited like any read: it costs
  // the same `hgetall`, and the flag is the caller's word.
  const limited = await enforceRateLimit(
    req,
    "quiz:read",
    QUIZ_READ_LIMIT,
    QUIZ_READ_WINDOW_SECONDS,
    "rate_limited"
  );
  if (limited) {
    await recordQuizThrottled("read");
    return limited;
  }

  try {
    const view = await getQuizView(code, token);
    if (!refetch) {
      await (view.owner ? recordQuizOwnerStage("owner_opened") : recordQuizStage("opened"));
    }
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
