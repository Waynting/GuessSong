/**
 * The wire contract of `GET /api/lyric` — the guess game's "Read a lyric
 * instead" — shared by the route and `lib/lyric-client.ts`.
 *
 * Kept out of `lib/lyrics.ts` for the reason `types/preview.ts` is kept out
 * of `lib/preview-cache.ts`: that module reaches `lib/kv.ts`, and the game
 * page's bundle must not pull in the Upstash client.
 */

import { LYRIC_STATUSES, type LyricStatus } from "@/types/quiz";

export { LYRIC_STATUSES, type LyricStatus };

/**
 * One line, or none, and why. `line` is non-null exactly when `status` is
 * `found`; a song whose every cached line names its own title answers
 * `absent`, because there is nothing the host could read aloud.
 */
export interface LyricLineResult {
  line: string | null;
  status: LyricStatus;
}

/**
 * A Spotify track id: the only thing `lib/lyrics.ts` keys its cache by. The
 * route answers anything else `absent` without asking upstream, because an
 * unkeyed lookup is an uncached one and would turn the route into an LRCLIB
 * amplifier.
 */
export const LYRIC_TRACK_ID = /^[A-Za-z0-9]{22}$/;

/** A settled answer is one asking again cannot change — the preview client's rule. */
export function isLyricSettled(status: LyricStatus): boolean {
  return status === "found" || status === "absent";
}
