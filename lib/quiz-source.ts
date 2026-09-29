/**
 * Where the person who made a quiz came from, as one of a closed set.
 *
 * `quiz_created.arrived_from` had this in GA4 alone — the side nobody opens —
 * and even there it was two values deep: a loop surface, or `organic`, the
 * bucket that absorbs every search visit, every bookmark and every lost
 * attribution at once. In the week to 2026-09-29 seventy-seven quizzes were
 * made and nothing in KV could say whether the people making them were
 * friends who had just finished one (the loop working) or strangers from a
 * search result (the page working). Those are different audiences with
 * different reasons not to send the link.
 *
 *   <loop surface>  the visitor followed one of ours — `quiz_result` is the
 *                   one that matters, a friend who finished a quiz and tapped
 *                   "make your own". Last touch, held sixty days, the same
 *                   credit `recallLoopRef` gives a game.
 *   internal        no loop credit, and the document was reached from this
 *                   site: a footer link, a guide, the redirect from `/`.
 *   external        no loop credit, and the referrer is somebody else's host:
 *                   a search result, a chat app's in-app browser.
 *   none            no referrer at all: typed, bookmarked, the installed PWA,
 *                   or a referrer the browser or the linking page stripped.
 *
 * **The referrer is compared, never kept.** A referrer is a URL somebody else
 * wrote, query string included, and it is user input in every sense CLAUDE.md's
 * analytics rule means: only the three words above ever leave this function,
 * and only after the host has been reduced to "ours or not". Nothing here
 * returns, logs or sends the string itself.
 *
 * `document.referrer` belongs to the document, not the route, so it answers
 * "how did this tab get to the site" for a visitor who landed on `/` from a
 * search and reached `/quiz` through a client-side link: `external`, which is
 * the truer answer. `internal` is a full navigation between our own pages.
 *
 * Dependency-free beyond `lib/loop-links.ts`, for that module's reason: the
 * quiz form, the create route and the KV counters all import it, and nothing
 * here may drag `lib/kv.ts` into a browser bundle.
 */

import { LOOP_SURFACES, isLoopSurface, type LoopSurface } from "@/lib/loop-links";

/** The three arrivals that are not a loop surface. */
export const QUIZ_ARRIVALS = ["internal", "external", "none"] as const;

export type QuizArrival = (typeof QUIZ_ARRIVALS)[number];

export type QuizSource = LoopSurface | QuizArrival;

/**
 * Derived, so a surface added to `LOOP_SURFACES` is a source the day it is
 * declared. Retyping the names here is the hand-sync `lib/loop-links.ts`
 * exists to prevent: the validator would refuse the new surface, the quiz
 * would still be made, and that arm would read as "nobody came from it".
 */
export const QUIZ_SOURCES: readonly QuizSource[] = [...LOOP_SURFACES, ...QUIZ_ARRIVALS];

const SOURCE_SET: ReadonlySet<string> = new Set(QUIZ_SOURCES);

/** Narrows an untrusted value — a request body's field — to a source. */
export function isQuizSource(value: unknown): value is QuizSource {
  return typeof value === "string" && SOURCE_SET.has(value);
}

/** `www.` is the same site: the apex redirects to it, and a link may name either. */
function siteOf(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Pure, so the rule has a test. `ref` is the remembered loop credit, `host`
 * is this page's own.
 *
 * A referrer that does not parse, or parses to no host (`about:blank`), is
 * `none` rather than `external`: "we could not tell" must not be filed under
 * "somebody sent them".
 */
export function quizSourceOf(input: {
  ref: string | null | undefined;
  referrer: string | null | undefined;
  host: string;
}): QuizSource {
  if (isLoopSurface(input.ref)) return input.ref;
  const referrer = (input.referrer ?? "").trim();
  if (!referrer) return "none";
  let from: string;
  try {
    from = new URL(referrer).host;
  } catch {
    return "none";
  }
  if (!from) return "none";
  return siteOf(from) === siteOf(input.host) ? "internal" : "external";
}

/**
 * The same, read off this document. `none` wherever there is no document to
 * read — the quiz page is prerendered — or the read throws.
 */
export function currentQuizSource(ref: string | null | undefined): QuizSource {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return isLoopSurface(ref) ? ref : "none";
  }
  try {
    return quizSourceOf({ ref, referrer: document.referrer, host: window.location.host });
  } catch {
    return isLoopSurface(ref) ? ref : "none";
  }
}
