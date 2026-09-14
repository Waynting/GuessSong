/**
 * /q/[code] — a playlist quiz, opened from a link in someone's group chat.
 *
 * A server component for one reason: the unfurl. The link *is* the card in
 * the chat, so the title has to say whose taste is being tested before anyone
 * taps. `peekQuiz` is fail-soft and shape-checks the code before touching KV,
 * so a crawler feeding `/q/../..` costs nothing and a KV hiccup degrades to a
 * generic quiz card rather than a 500. It does not count an open — every chat
 * app's unfurler fetches this; `GET /api/quiz/[code]`, which only the page's
 * own script calls, is where opens are counted.
 *
 * Ephemeral, so `noindex` — and *not* in robots.ts's disallow list, unlike
 * `/j`. Facebook, X and LinkedIn honour robots.txt when they unfurl, so a
 * disallowed quiz link drew no card at all on the platforms a link gets
 * posted to; `noindex` is the control that says "do not list this" while
 * letting the unfurler read the page. app/q/layout.tsx applies it to the
 * board too.
 *
 * ## The card names *this* quiz, and two things used to stop it
 *
 * A nested `generateMetadata` inherits every top-level key it does not set.
 * `alternates` was one of them, so this page shipped with the root layout's
 * `<link rel="canonical" href="https://www.guessong.app">` in its head — and
 * Facebook resolves a canonical before it reads a card, so a quiz shared
 * there unfurled as the *home page*: the party-game title and the party-game
 * image, with the owner's name nowhere. The self-canonical and `openGraph.url`
 * below are what pin the card to this URL; `tests/quiz-unfurl.test.ts` pins
 * them in turn.
 *
 * The image is the sibling `opengraph-image.tsx`, rendered per quiz so the
 * picture says whose taste it is — the picture is most of the card, and a
 * card whose title names the owner over a picture selling the party game
 * read as canned. It is the one generated image on the site that is not
 * built once, and it carries its own edge cache header so that it is
 * rendered once per quiz, not once per unfurler; the file explains. Next
 * attaches the file-convention image to this page's `openGraph` and
 * `twitter` metadata itself, which is why neither block names an image —
 * and builds its URL from the segment as typed, which is why the page
 * component sends a non-canonical spelling to the canonical one first.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeQuizCode, peekQuiz } from "@/lib/quiz-store";
import { QUIZ_COPY, fillCopy, quizTitle } from "@/lib/quiz-copy";
import { QuizClient } from "./quiz-client";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const peek = await peekQuiz(code);
  const noindex = { index: false, follow: false };
  if (!peek) {
    // Gone, malformed, or KV blinked: still a quiz-shaped card, still no
    // inherited canonical — `null` drops the root's, and the hreflang set
    // that a one-sided declaration would misdescribe goes with it.
    const title = QUIZ_COPY.en.ogFallbackTitle;
    const description = QUIZ_COPY.en.ogFallbackDescription;
    return {
      title,
      description,
      robots: noindex,
      alternates: { canonical: null },
      openGraph: { title, description, type: "website", siteName: "GuessSong" },
      twitter: { card: "summary_large_image", title, description },
    };
  }
  const copy = QUIZ_COPY[peek.locale];
  const title = quizTitle(copy, peek.ownerName);
  const description = fillCopy(copy.ogDescription, { count: peek.questionCount });
  const url = `/q/${peek.code}`;
  return {
    title,
    description,
    robots: noindex,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", siteName: "GuessSong" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function QuizPage({ params }: Params) {
  const { code } = await params;
  // One URL per quiz. A link retyped in lower case still opens — through the
  // canonical spelling, so the card image Next attaches (built from the
  // segment as typed) has one edge-cache key per quiz, not one per spelling.
  // A malformed segment falls through to the client, which reports it.
  const canonical = normalizeQuizCode(code);
  if (canonical && canonical !== code) redirect(`/q/${canonical}`);
  return <QuizClient code={code} />;
}
