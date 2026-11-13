/**
 * POST /api/quiz — turn a public playlist into a shareable quiz link.
 *
 * The one Spotify-bearing step of the feature, and it goes through
 * `loadPlaylist` like every other caller: a repeat playlist costs nothing
 * upstream, a cold one costs the same single load a party does. Nothing a
 * friend does later touches Spotify — the questions are stored.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadPlaylist } from "@/lib/playlist-cache";
import { marketFromHeaders } from "@/lib/market";
import { SpotifyApiError } from "@/lib/spotify";
import { createQuiz, QuizError, type LyricSource } from "@/lib/quiz-store";
import { QUIZ_DECOY_POOL } from "@/lib/quiz-decoys";
import { lookupLyricCandidates } from "@/lib/lyrics";
import { recordQuizCreated, recordQuizLyricLookup, recordQuizThrottled } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-error";
import { ERROR_LOCALES } from "@/lib/error-messages";
import { isQuizSource } from "@/lib/quiz-source";
import {
  DEFAULT_QUIZ_KIND,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_NAME_MAX,
  isQuizKind,
  type CreateQuizResponse,
} from "@/types/quiz";

/** Tighter than the playlist route: a quiz is made once and shared, not retried. */
const QUIZ_CREATE_LIMIT = 10;
const QUIZ_CREATE_WINDOW_SECONDS = 10 * 60;

/**
 * `from` is `unknown` on purpose, and must not be tightened to an enum of
 * `QUIZ_SOURCES`. It is a measurement riding on a request whose job is making
 * a quiz: validated in the schema, a value this build does not know — a
 * surface a newer page was deployed with, a typo, junk — would fail the parse
 * and refuse the host their link over a counter. It is narrowed below with
 * `isQuizSource`, where not recognising it costs the count and nothing else.
 */
const CreateQuizSchema = z.object({
  url: z.string().trim().min(1),
  ownerName: z.string().trim().max(QUIZ_NAME_MAX).optional(),
  questionCount: z.number().int().min(QUIZ_MIN_QUESTIONS).max(QUIZ_MAX_QUESTIONS),
  locale: z.enum(ERROR_LOCALES).optional(),
  from: z.unknown().optional(),
  // `unknown` for the reason `from` is: a kind this build does not know is
  // the default kind, never a refused link.
  kind: z.unknown().optional(),
});

/**
 * The lyrics database, with each upstream lookup counted. Only handed to the
 * store for a `lyric` request, so a duel never touches lib/lyrics.ts.
 */
const lyricSource: LyricSource = (tracks) =>
  lookupLyricCandidates(tracks, (status) => void recordQuizLyricLookup(status));

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "quiz:create",
    QUIZ_CREATE_LIMIT,
    QUIZ_CREATE_WINDOW_SECONDS,
    "rate_limited_quiz_create"
  );
  if (limited) {
    await recordQuizThrottled("create");
    return limited;
  }

  let body: z.infer<typeof CreateQuizSchema>;
  try {
    body = CreateQuizSchema.parse(await req.json());
  } catch {
    return errorResponse("quiz_create_invalid", 400);
  }

  try {
    // An artist link plays as a top ten; the market is the request's country.
    const playlist = await loadPlaylist(body.url, "quiz-create", { market: marketFromHeaders(req.headers) });
    const kind = isQuizKind(body.kind) ? body.kind : DEFAULT_QUIZ_KIND;
    const created = await createQuiz({
      tracks: playlist.tracks,
      questionCount: body.questionCount,
      ownerName: body.ownerName ?? null,
      playlistName: playlist.name,
      locale: body.locale ?? "en",
      pool: QUIZ_DECOY_POOL,
      kind,
      ...(kind === "lyric" ? { lyricSource } : {}),
    });
    // The built count, not the requested one: `createQuiz` shortens a quiz to
    // the playlist's usable tracks, and the quiz that exists is the one to
    // count. The gap between the two is `quiz_clamped`. The kind likewise:
    // the one built, with the one asked for beside it for `quiz_lyric_fallback`.
    await recordQuizCreated({
      questionCount: created.questionCount,
      requestedCount: body.questionCount,
      locale: body.locale ?? "en",
      from: isQuizSource(body.from) ? body.from : undefined,
      kind: created.kind,
      requestedKind: kind,
    });
    return NextResponse.json<CreateQuizResponse>({
      code: created.code,
      expiresAt: created.expiresAt,
      questionCount: created.questionCount,
      kind: created.kind,
      playlistName: playlist.name,
      hostToken: created.hostToken,
    });
  } catch (err: unknown) {
    // The code is carried through, never flattened: a host whose creation
    // lands in a Spotify cooldown is not holding a broken playlist. The status
    // is normalised the way `lib/room.ts` does it — a 429 stays a 429 so the
    // client can tell throttling from a bad link, and everything else is a
    // 422 rather than Spotify's own 401/403/5xx leaking through a public route.
    if (err instanceof SpotifyApiError) {
      return errorResponse(err.code, err.status === 429 ? 429 : 422, {
        params: err.params,
        retryAfter: err.retryAfterSeconds,
      });
    }
    if (err instanceof QuizError) {
      return errorResponse(err.code, err.status, { params: err.params });
    }
    console.error("[quiz] create failed", err);
    return errorResponse("quiz_create_failed", 500);
  }
}
