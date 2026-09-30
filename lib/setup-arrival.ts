/**
 * Where a link that asks for a particular way of playing should land.
 *
 * Two kinds do. A link that asks for Mixed Playlist Mode (`MIXED_SETUP_HREF`
 * below) stays on `/` and opens the form on it. A link that asks for the Taste
 * Quiz leaves, and the rest of this header is why:
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
 * The setup form, opened on Mixed Playlist Mode.
 *
 * Mixed had no address while the only way to it was the text link under the
 * Start button. "One tap away" is true of a host standing on `/` and false of
 * one standing on the Game Over screen, where "next time, everyone brings a
 * playlist" could only be said by sending the room to the single-playlist
 * form and hoping somebody found the link.
 *
 * Exported so that screen imports the address rather than retyping it — the
 * rule `QUIZ_SETUP_HREF` follows, and `tests/setup-arrival.test.ts` pins that
 * this string and `requestedSetupMode` agree. Relative, so it works on a
 * preview deploy.
 */
export const MIXED_SETUP_HREF = "/?mode=mixed";

/**
 * The modes a URL may ask for. Single Playlist is the default and has no
 * spelling: a link that wants it says nothing. Extending this is adding a
 * member and a trigger below, not a second mechanism.
 *
 * The two members do different things on arrival, which is why `/` compares
 * the value rather than treating it as a flag: `quiz` leaves for the quiz's
 * own page, `mixed` stays and opens the form on Mixed.
 */
export type RequestedSetupMode = "quiz" | "mixed";

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
 *
 * A spelled-out `?mode=` outranks what a `?ref=` implies. The ref is
 * attribution: it says where the visitor came from, and implies a destination
 * only for the quiz's own surface. The mode is the link saying where it wants
 * to go. Nothing of ours produces `/?mode=mixed&ref=quiz_result` today, but
 * the half that was spelled out is the half to believe. The ref is remembered
 * either way — `/` stores it before it asks this.
 */
export function requestedSetupMode(query: URLSearchParams): RequestedSetupMode | null {
  const mode = query.get("mode");
  if (mode === "quiz") return "quiz";
  if (mode === "mixed") return "mixed";
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
