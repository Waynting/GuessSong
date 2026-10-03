import type { Metadata } from "next";
import { QuizMine } from "./mine-client";

/**
 * /q/mine — the owner's dashboard: every quiz this device made.
 *
 * Under `/q` rather than `/quiz` on purpose: the page is a different list in
 * every browser and empty to a crawler, so it wants `noindex`, which
 * app/q/layout.tsx already applies — and nothing under `app/quiz/` may carry
 * one, because `/quiz` is the quiz's one indexable page
 * (`tests/setup-pages.test.ts`). A static segment beside `[code]` wins the
 * route, and "mine" is not six characters, so it can never be a quiz code.
 */
export const metadata: Metadata = {
  title: "My quizzes",
};

export default function QuizMinePage() {
  return <QuizMine />;
}
