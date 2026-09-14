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
 */

import type { Metadata } from "next";
import { peekQuiz } from "@/lib/quiz-store";
import { QUIZ_COPY, fillCopy } from "@/lib/quiz-copy";
import { QuizClient } from "./quiz-client";

type Params = { params: Promise<{ code: string }> };

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
  return {
    title,
    description,
    robots: noindex,
    openGraph: { title, description, type: "website", siteName: "GuessSong" },
    twitter: { card: "summary", title, description },
  };
}

export default async function QuizPage({ params }: Params) {
  const { code } = await params;
  return <QuizClient code={code} />;
}
