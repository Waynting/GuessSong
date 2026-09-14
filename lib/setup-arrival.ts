/**
 * What the URL the setup page arrived on says about which mode to open in.
 *
 * Two ways in, one rule. A friend who has just finished someone's quiz taps
 * "Make one for your friends", which is `/r/quiz_result`, and the redirect
 * lands them on `/?ref=quiz_result`. Before this that page opened on Single
 * Playlist with the hero on screen and the Taste Quiz pill three screens down
 * and unmarked — the call to action delivered people to a page that did not
 * look like the thing they had just been promised, and the loop's one warm
 * arm was being measured against that landing. `/about` and `/zh` link the
 * quiz with an explicit `?mode=quiz`, which says the same thing without
 * spending a loop count on a link that is not a loop surface.
 *
 * Kept in `lib/` so the rule has a test — `app/page.tsx` reads the query off
 * `window.location` in an effect, which the suite cannot reach — and typed
 * against `LoopSurface` so a renamed surface is a compile error here rather
 * than a redirect that quietly lands on the wrong tab again.
 */

import { isLoopSurface, type LoopSurface } from "@/lib/loop-links";

/**
 * The modes a URL may ask for. Only the quiz for now: Single Playlist is the
 * default and Mixed is one tap away from it, so neither has a link that needs
 * to say so. Extending this is adding a member and a trigger below, not a
 * second mechanism.
 */
export type RequestedSetupMode = "quiz";

/**
 * Loop surfaces whose visitor was just shown a quiz and followed a call to
 * make one. A `Set<LoopSurface>` rather than a string compare so the surface
 * name is spelled once, in `lib/loop-links.ts`.
 */
const QUIZ_SURFACES: ReadonlySet<LoopSurface> = new Set<LoopSurface>(["quiz_result"]);

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

/** The link a content page uses to open the setup page on the quiz. */
export const QUIZ_SETUP_HREF = "/?mode=quiz";
