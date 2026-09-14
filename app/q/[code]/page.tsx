/**
 * /q/[code] — a playlist quiz, opened from a link in someone's group chat.
 *
 * A server component for one reason: the unfurl. The link *is* the card in
 * the chat, so the title has to say whose taste is being tested before anyone
 * taps. `peekQuiz` is fail-soft and shape-checks the code before touching KV,
 * so a crawler feeding `/q/../..` costs nothing and a KV hiccup degrades to a
 * static title rather than a 500. It does not count an open — every chat app's
 * unfurler fetches this; `GET /api/quiz/[code]`, which only the page's own
 * script calls, is where opens are counted.
 *
 * Ephemeral, so `noindex` and in robots.ts's disallow list, like `/j`.
 *
 * The card carries the site's one static image, not a per-quiz one. Next
 * replaces a parent's `openGraph` wholesale when a segment sets its own, so
 * without `images` here the quiz link unfurled as text in every chat app —
 * LINE, WhatsApp and iMessage all draw a text-only card for a page with no
 * `og:image`, and the link in a group chat is this feature's whole
 * distribution. A satori render per quiz would be `ƒ`, paid once per
 * unfurler per share, on the most expensive render in the app
 * (CLAUDE.md, "SEO / Metadata"); `/opengraph-image` is built once and costs
 * every unfurler nothing. Relative URLs resolve against the root layout's
 * `metadataBase`, which a nested `generateMetadata` inherits.
 */

import type { Metadata } from "next";
import { peekQuiz } from "@/lib/quiz-store";
import { QUIZ_COPY, fillCopy } from "@/lib/quiz-copy";
import { QuizClient } from "./quiz-client";

type Params = { params: Promise<{ code: string }> };

/** The site's build-time card, as app/layout.tsx declares it. */
const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630 };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const peek = await peekQuiz(code);
  const noindex = { index: false, follow: false };
  if (!peek) {
    return { title: "Music taste quiz", robots: noindex };
  }
  const copy = QUIZ_COPY[peek.locale];
  const title = peek.ownerName
    ? fillCopy(copy.introTitleOwner, { owner: peek.ownerName })
    : copy.introTitlePlaylist;
  const description = fillCopy(copy.ogDescription, { count: peek.questionCount });
  const images = [{ ...OG_IMAGE, alt: title }];
  return {
    title,
    description,
    robots: noindex,
    openGraph: { title, description, type: "website", siteName: "GuessSong", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function QuizPage({ params }: Params) {
  const { code } = await params;
  return <QuizClient code={code} />;
}
