/**
 * GET /api/quiz/[code]/hint?q=N[&refresh=1] — a clip of the song that is
 * really in the playlist, for question N.
 *
 * Exists so the taker's phone never has to name the right answer: calling
 * `/api/preview?track=…` from the client would put the answer in the request.
 * The clip is resolved through lib/preview-cache.ts like every other, so it
 * is cached, budgeted and cooled down the same way, and a throttled minute
 * answers `unavailable` — which the page shows as "no clip", without charging
 * the hint.
 *
 * The allowance (`hintAllowance`, one per ten questions) is enforced on the
 * phone, not here: with no identity there is nothing to count a tap against,
 * so this route bounds the upstream spend by IP alone. Sixty per ten minutes
 * is a household of honest takers; a determined one can hear every question,
 * which the store's own comment on `clampHintsUsed` already concedes.
 *
 * `refresh=1` re-resolves a URL that stopped playing, on its own much tighter
 * limit, exactly as `GET /api/preview` does — a refresh bypasses the cache and
 * is the one parameter here that can be turned into an upstream amplifier.
 */

import { NextRequest, NextResponse } from "next/server";
import { getQuizHint, QuizError } from "@/lib/quiz-store";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import type { PreviewResult } from "@/types/preview";

const QUIZ_HINT_LIMIT = 60;
const QUIZ_HINT_WINDOW_SECONDS = 10 * 60;
const QUIZ_HINT_REFRESH_LIMIT = 10;
const QUIZ_HINT_REFRESH_WINDOW_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const { searchParams } = new URL(req.url);
  const index = Number(searchParams.get("q"));
  const refresh = searchParams.get("refresh") === "1";

  const limited = await enforceRateLimit(
    req,
    refresh ? "quiz:hint:refresh" : "quiz:hint",
    refresh ? QUIZ_HINT_REFRESH_LIMIT : QUIZ_HINT_LIMIT,
    refresh ? QUIZ_HINT_REFRESH_WINDOW_SECONDS : QUIZ_HINT_WINDOW_SECONDS,
    "rate_limited_preview"
  );
  if (limited) return limited;

  try {
    const result = await getQuizHint(code, index, { refresh });
    return NextResponse.json<PreviewResult>(result);
  } catch (err: unknown) {
    if (err instanceof QuizError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    console.error("[quiz] hint failed", err);
    return errorResponse("server_error", 500);
  }
}
