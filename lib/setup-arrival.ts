/**
 * Where a link that asks for the Taste Quiz should land.
 *
 * The quiz has its own page, `/quiz`. It used to be a mode of the setup form
 * at `/`, reached by `?mode=quiz` from the content pages and by
 * `?ref=quiz_result` from the loop's one warm arm — a friend who has just
 * finished someone's quiz and tapped "make your own". Those two spellings are
 * still out there, in group chats and in cached pages, so `/` recognises them
 * and redirects rather than opening on the party form with the quiz nowhere
 * in sight, which is the landing this file was first written to fix.
 *
 * Kept in `lib/` so the rule has a test — `app/page.tsx` reads the query off
 * `window.location` in an effect, which the suite cannot reach — and typed
 * against `LoopSurface` so a renamed surface is a compile error here rather
 * than a redirect that quietly lands on the wrong page again.
 */

import { isLoopSurface, type LoopSurface } from "@/lib/loop-links";

/** The quiz's own page. Content pages and the loop both point here. */
export const QUIZ_SETUP_HREF = "/quiz";

/**
 * The modes a URL may ask for. Only the quiz: Single Playlist is the default
 * and Mixed is one tap away from it, so neither has a link that needs to say
 * so. Extending this is adding a member and a trigger below, not a second
 * mechanism.
 */
export type RequestedSetupMode = "quiz";

/**
 * Loop surfaces whose visitor was just shown a quiz and followed a call to
 * make one. A `Set<LoopSurface>` rather than a string compare so the surface
 * name is spelled once, in `lib/loop-links.ts`. `lib/loop-redirect.ts` reads
 * it to send those clicks straight to `/quiz`; `/` reads it to catch the
 * ones that still arrive the old way.
 */
const QUIZ_SURFACES: ReadonlySet<LoopSurface> = new Set<LoopSurface>(["quiz_result"]);

export function isQuizSurface(surface: LoopSurface): boolean {
  return QUIZ_SURFACES.has(surface);
}

/**
 * `null` for every arrival that asked for nothing, which is nearly all of
 * them: the page must behave exactly as it always has for a search visitor, a
 * `?playlist=` share-target redirect, or a loop click from a party surface.
 *
 * Exact matches only. `?mode=` is a public URL like `?ref=` is, and the
 * value is compared, never reflected, so nothing typed into it can reach the
 * page — but it is still not worth being lenient about: `QUIZ` or `quiz `
 * is not a link anything of ours produced.
 */
export function requestedSetupMode(query: URLSearchParams): RequestedSetupMode | null {
  if (query.get("mode") === "quiz") return "quiz";
  const ref = query.get("ref");
  if (isLoopSurface(ref) && QUIZ_SURFACES.has(ref)) return "quiz";
  return null;
}

/**
 * The `/quiz` URL an old-style arrival is redirected to. The `ref` rides
 * along when it is one of ours, so the loop attribution the click carried is
 * not lost in the hop; anything else in the query is dropped, because nothing
 * else in it was ever meant for the quiz.
 */
export function quizArrivalHref(query: URLSearchParams): string {
  const ref = query.get("ref");
  return isLoopSurface(ref) ? `${QUIZ_SETUP_HREF}?ref=${ref}` : QUIZ_SETUP_HREF;
}
