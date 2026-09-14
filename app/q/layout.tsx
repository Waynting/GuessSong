import type { Metadata } from "next";

/**
 * Everything under /q is a code that stops resolving after a week: noindex,
 * the way app/game/layout.tsx does it. Robots.txt is deliberately *not* the
 * tool — a disallow keeps the unfurlers that honour it (Facebook, X) from
 * reading the quiz's card at all, and the link in a group chat is the
 * feature's whole distribution. The quiz page sets its own `robots` too;
 * this is what covers the board and anything added beside it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Nothing under /q is the home page, which is what the root layout's
  // canonical would otherwise say about it. The quiz page sets its own.
  alternates: { canonical: null },
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
