/**
 * One lyric line for the guess game's "Read a lyric instead": the host reads
 * it aloud, the room shouts the song, the host still judges.
 *
 * Every rule that matters lives elsewhere and is reused, never re-written:
 * the LRCLIB lookup, its budget, cooldown and cache are `lib/lyrics.ts`
 * (`lyrics:v1:<id>`, the quiz's own key — one cache, one key shape), and the
 * line itself is `lib/lyric-fragment.ts`. So the legal bounds are the quiz's
 * unchanged: KV holds at most `LYRIC_CANDIDATES_MAX` lines cut to
 * `QUIZ_LYRIC_MAX_CHARS`, never `plainLyrics`, and this route hands out one
 * of them per request.
 *
 * ## Which line
 *
 * Deterministic: the first cached candidate (they are stored best-first, the
 * chorus before the verses) that does not name the song's title, compared
 * through `titleKey` by `pickLyricLine`. The candidates were already filtered
 * against the title when they were cached; the check is run again against the
 * title on this request because the quiz may have cached them under another
 * spelling of it. Deterministic so a host who asks twice reads the same line,
 * and so the client can cache the answer by track id.
 *
 * ## The three outcomes
 *
 * `found` and `absent` are facts (cached by `lib/lyrics.ts` a month and a
 * week); `unavailable` is about us — throttled, out of budget, a timeout —
 * and is held for ninety seconds only. A song whose every candidate names its
 * title answers `absent`: there is nothing to read.
 *
 * Counted per request as `lyric_line:<status>`, server-side, because this is
 * the only place that knows the outcome whether or not the page survives to
 * report it.
 */

import { NextRequest, NextResponse } from "next/server";
import { LYRIC_LINE_WAIT_MS, lookupLyricCandidates } from "@/lib/lyrics";
import { pickLyricLine } from "@/lib/lyric-fragment";
import { recordLyricLine } from "@/lib/loop-stats";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clampPreviewField } from "@/types/preview";
import { LYRIC_TRACK_ID, type LyricLineResult } from "@/types/lyric-line";

/**
 * Sized for a party: one phone, a game of at most fifty rounds, a host who
 * may read a lyric on every one and play a second game inside the window. The
 * global LRCLIB budget in lib/lyrics.ts bounds the aggregate; this bounds one
 * address.
 */
const LYRIC_LINE_LIMIT = 120;
const LYRIC_LINE_WINDOW_SECONDS = 10 * 60;

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(
    req,
    "lyric",
    LYRIC_LINE_LIMIT,
    LYRIC_LINE_WINDOW_SECONDS,
    "rate_limited_lyric"
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("track") ?? "").trim();
  // Code-point clamps, the preview routes' rule: these strings reach the
  // title fold and LRCLIB's query, and an unauthenticated caller writes them.
  const name = clampPreviewField(searchParams.get("name") ?? "");
  const artist = clampPreviewField(searchParams.get("artist") ?? "");
  const duration = Number(searchParams.get("durationMs"));
  const durationMs = Number.isFinite(duration) && duration > 0 ? duration : 0;

  // Nothing to key a cache by, or nothing to exclude: not a request this
  // route can answer, and not one worth counting.
  if (!LYRIC_TRACK_ID.test(id) || !name) {
    return NextResponse.json<LyricLineResult>({ line: null, status: "absent" });
  }

  const results = await lookupLyricCandidates(
    [{ id, name, artists: artist ? [artist] : [], durationMs }],
    undefined,
    // A second of LRCLIB's Retry-After is worth sitting out; more is not.
    { waitBudgetMs: LYRIC_LINE_WAIT_MS }
  );
  const result = results.get(id) ?? { status: "unavailable" as const, lines: [] };

  let body: LyricLineResult;
  if (result.status === "found") {
    const line = pickLyricLine(result.lines, [name]);
    body = line ? { line, status: "found" } : { line: null, status: "absent" };
  } else {
    body = { line: null, status: result.status };
  }

  await recordLyricLine(body.status);
  return NextResponse.json<LyricLineResult>(body);
}
