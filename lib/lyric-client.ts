/**
 * Browser half of the guess game's "Read a lyric instead" (`GET /api/lyric`).
 *
 * Free of any server import for `lib/preview-client.ts`'s reason: the
 * lookup's other half reaches `lib/kv.ts`. The contract both halves share is
 * `types/lyric-line.ts`.
 *
 * Every failure resolves to `unavailable`, never `absent`: a dropped request
 * or a 429 is "we could not ask", and only a clean answer may say there is
 * no line.
 */

import { isLyricSettled, type LyricLineResult } from "@/types/lyric-line";

const UNAVAILABLE: LyricLineResult = { line: null, status: "unavailable" };

export interface LyricLineTrack {
  id: string;
  name: string;
  artist: string;
  durationMs?: number;
}

function toResult(body: unknown): LyricLineResult {
  const data = (body ?? {}) as Partial<LyricLineResult>;
  const line = typeof data.line === "string" && data.line.trim() ? data.line : null;
  if (data.status === "found") return line ? { line, status: "found" } : { line: null, status: "absent" };
  if (data.status === "absent") return { line: null, status: "absent" };
  return UNAVAILABLE;
}

export async function fetchLyricLine(track: LyricLineTrack): Promise<LyricLineResult> {
  const params = new URLSearchParams({ track: track.id, name: track.name, artist: track.artist });
  if (track.durationMs && track.durationMs > 0) params.set("durationMs", String(track.durationMs));
  try {
    const res = await fetch(`/api/lyric?${params.toString()}`);
    if (!res.ok) return UNAVAILABLE;
    return toResult(await res.json());
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * The lyric for the round on screen, or `null` when the round has moved on.
 *
 * `stillThisRound` is the predicate `roundToken.begin()` handed back, taken
 * *before* this is called — lib/round-token.ts's rule. A stale answer is
 * dropped from the round but still cached by track id (settled answers only,
 * the `previewCache` rule), because the host who skipped past the track may
 * come back to it. A cached answer is returned without asking.
 */
export async function readLyricForRound(
  track: LyricLineTrack,
  stillThisRound: () => boolean,
  cache: Map<string, LyricLineResult>,
  fetcher: (track: LyricLineTrack) => Promise<LyricLineResult> = fetchLyricLine
): Promise<LyricLineResult | null> {
  const cached = cache.get(track.id);
  const result = cached ?? (await fetcher(track));
  if (!cached && isLyricSettled(result.status)) cache.set(track.id, result);
  return stillThisRound() ? result : null;
}
