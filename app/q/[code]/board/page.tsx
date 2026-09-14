"use client";

/**
 * /q/[code]/board — the owner's results page.
 *
 * What rikaido.me calls the results dashboard: who took it, the ranking, and
 * per question how many got it. Host-only, because the per-question rows name
 * the answers; the token comes from this device's localStorage
 * (`lib/quiz-session.ts`), which is the only place "the person who made it"
 * exists without an account. On any other device the page says so and points
 * at the quiz, whose public ranking is the part that is safe to show anyone.
 *
 * A client page rather than a server one: there is no unfurl to serve here
 * (nobody shares their own results URL), and the token is in the browser.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { apiError, describeError, errorMessage } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { QUIZ_COPY, fillCopy, formatQuizDate, ownerShareText, quizTitle } from "@/lib/quiz-copy";
import { quizUrl, recallQuizToken } from "@/lib/quiz-session";
import { COPIED_FLASH_MS, copyLink, shareLink } from "@/lib/quiz-share";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { QuizBoardResponse } from "@/types/quiz";
import { Shell } from "../shell";

type Phase = "loading" | "not_host" | "error" | "ready";

export default function QuizBoardPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const locale = useErrorLocale();
  const copy = QUIZ_COPY[locale];

  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<QuizBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    const token = recallQuizToken(code);
    if (!token) {
      setPhase("not_host");
      return;
    }
    try {
      // The token rides in a header, as the room's does — never the query
      // string, which access logs keep.
      const res = await fetch(`/api/quiz/${encodeURIComponent(code)}/board`, {
        cache: "no-store",
        headers: { "x-host-token": token },
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          setPhase("not_host");
          return;
        }
        throw apiError(data, "quiz_board_failed");
      }
      setBoard(data as QuizBoardResponse);
      setPhase("ready");
    } catch (e: unknown) {
      setError(describeError(e, locale, "quiz_board_failed"));
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale only colours the sentence
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const url = quizUrl(code);

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  }

  async function handleShare() {
    if (!board) return;
    const outcome = await shareLink({ url, text: ownerShareText(copy, board) });
    if (outcome === "copied") flashCopied();
    trackEvent("quiz_share_tapped", { by: "owner", outcome });
  }

  async function handleCopy() {
    const outcome = await copyLink(url);
    if (outcome === "copied") flashCopied();
    trackEvent("quiz_share_tapped", { by: "owner", outcome });
  }

  if (phase === "loading") {
    return (
      <Shell>
        <p className="text-center text-sm text-muted-foreground">{copy.loading}</p>
      </Shell>
    );
  }

  if (phase === "not_host") {
    return (
      <Shell>
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle>{copy.boardPageTitle}</CardTitle>
            <CardDescription>{errorMessage("quiz_not_host", locale)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href={`/q/${code}`}>{copy.boardOpenQuiz} →</a>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === "error" || !board) {
    return (
      <Shell>
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle>{copy.boardPageTitle}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void load()}>
              {copy.retry}
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const title = quizTitle(copy, board.ownerName);

  return (
    <Shell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            GuessSong · {copy.boardPageTitle}
          </p>
          <CardTitle className="text-xl leading-tight">{title}</CardTitle>
          <CardDescription>
            {board.playlistName} · {fillCopy(copy.boardQuestionCount, { count: board.questionCount })} ·{" "}
            {fillCopy(copy.expires, { date: formatQuizDate(board.expiresAt, locale) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* The two numbers that answer "did it work" */}
          <div className="flex items-baseline justify-between rounded-lg bg-secondary/40 px-4 py-3">
            <span className="text-2xl font-bold">
              {fillCopy(copy.boardTakers, { count: board.takers })}
            </span>
            {board.averageCorrect !== null && (
              <span className="text-sm text-muted-foreground">
                {fillCopy(copy.boardAverage, {
                  avg: board.averageCorrect.toFixed(1),
                  total: board.questionCount,
                })}
              </span>
            )}
          </div>

          {board.takers === 0 && (
            <p className="text-sm text-muted-foreground">{copy.boardEmpty}</p>
          )}

          {board.scoreboard.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                {copy.boardRankingTitle}
              </p>
              <ol className="flex flex-col">
                {board.scoreboard.map((r, i) => (
                  <li
                    key={`${i}-${r.name}`}
                    className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm odd:bg-secondary/20"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="w-5 text-muted-foreground">{i + 1}</span>
                      <span className="truncate">{r.name}</span>
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      {r.hintsUsed > 0 && (
                        <span className="text-xs text-muted-foreground" title={copy.boardHintsColumn}>
                          🎧{r.hintsUsed}
                        </span>
                      )}
                      <span className="font-medium">
                        {r.correct}/{r.total}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Per question — the part that makes this page host-only */}
          <div>
            <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
              {copy.boardPerQuestion}
            </p>
            <ol className="flex flex-col gap-2">
              {board.questions.map((q, i) => {
                const rate = q.answered > 0 ? q.correct / q.answered : null;
                return (
                  <li key={i} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm">
                        <span className="mr-2 text-xs text-muted-foreground">
                          {fillCopy(copy.boardQuestionLabel, { n: i + 1 })}
                        </span>
                        <span className="font-medium">{q.title}</span>
                        {q.artist && <span className="text-muted-foreground"> — {q.artist}</span>}
                      </span>
                      <span className="shrink-0 text-sm tabular-nums">
                        {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-secondary">
                      <div
                        className="h-full bg-[#1DB954]"
                        style={{ width: `${rate === null ? 0 : Math.round(rate * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {q.answered > 0
                        ? fillCopy(copy.boardCorrectRate, { correct: q.correct, answered: q.answered })
                        : copy.boardNoData}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Getting more people onto it is the whole job of this page */}
          <div className="flex flex-col gap-2">
            <p className="break-all text-center font-mono text-xs text-[#1DB954]">
              {url.replace(/^https?:\/\//, "")}
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void handleShare()}>
                {copy.boardShareLink} →
              </Button>
              <Button variant="secondary" onClick={() => void handleCopy()}>
                {copied ? copy.copied : copy.boardCopyLink}
              </Button>
            </div>
            <Button asChild variant="outline">
              <a href={`/q/${code}`}>{copy.boardOpenQuiz} →</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
