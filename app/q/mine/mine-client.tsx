"use client";

/**
 * The owner's dashboard, without an account.
 *
 * Before it, an owner's handle on a quiz was the one panel `/quiz` gives back
 * (the last quiz only) and the board URL, which nothing listed — so a second
 * quiz pushed the first out of reach unless its board was bookmarked. The
 * tokens for the last `QUIZ_TOKENS_MAX` quizzes were already on the device
 * (`lib/quiz-session.ts`); this page sends them to `POST /api/quiz/mine` in
 * one request and draws a card per quiz: who has answered, the top of the
 * board, when the last answer landed, how long the link has left.
 *
 * Three rules:
 *
 * - **No answers here.** A card carries what the public ranking on
 *   `/q/<code>` shows anyone; the per-question rows stay on the board, one
 *   tap away, behind the same token. That keeps this page's response from
 *   being a second thing to guard.
 * - **Fetched on open, on Refresh and when the tab comes back — never on a
 *   timer.** Each fetch is up to ten `hgetall`s; an owner leaving the tab open
 *   all evening would otherwise be the most expensive reader of the quiz.
 * - **"+N new" is a convenience, not a record.** The counts last shown are
 *   kept on the device, and storage that throws shows no badges.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiError, describeError } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { reportQuizCopy } from "@/lib/loop-client";
import { QUIZ_COPY, fillCopy, quizTitle, relativeTime } from "@/lib/quiz-copy";
import {
  listQuizTokens,
  quizUrl,
  recallSeenTakers,
  rememberSeenTakers,
} from "@/lib/quiz-session";
import { COPIED_FLASH_MS, copyLink } from "@/lib/quiz-share";
import { QUIZ_SETUP_HREF } from "@/lib/setup-arrival";
import { Button } from "@/components/ui/button";
import type { QuizMineItem, QuizMineRequest, QuizMineResponse, QuizMineSummary } from "@/types/quiz";
import { Shell } from "../[code]/shell";

type Phase = "loading" | "empty" | "error" | "ready";

const display = { fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSynthesis: "none" } as const;

/** A tab that comes back sooner than this keeps what it shows. */
const REFETCH_ON_FOCUS_MS = 30_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function QuizMine() {
  const locale = useErrorLocale();
  const copy = QUIZ_COPY[locale];

  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<QuizMineItem[]>([]);
  // The failure itself, not its sentence: `load` is created once, while the
  // locale moves in an effect after mount, so a sentence built inside it was
  // always English. Rendered with the locale of the render that shows it.
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // The counts last shown, as they were when this page opened — so a badge
  // stays up for this visit rather than vanishing on the first refresh.
  const seenAtOpen = useRef<Record<string, number> | null>(null);
  const lastFetch = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const entries = listQuizTokens();
      if (entries.length === 0) {
        setPhase("empty");
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      lastFetch.current = Date.now();
      try {
        const body: QuizMineRequest = {
          quizzes: entries.map(({ code, token }) => ({ code, token })),
        };
        const res = await fetch("/api/quiz/mine", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw apiError(data, "quiz_board_failed");
        const loaded = (data as QuizMineResponse).quizzes;
        if (seenAtOpen.current === null) seenAtOpen.current = recallSeenTakers();
        setItems(loaded);
        setError(null);
        setPhase("ready");
        const seen: Record<string, number> = {};
        for (const q of loaded) if (q.status === "ok") seen[q.code] = q.takers;
        rememberSeenTakers(seen);
      } catch (e: unknown) {
        setError(e);
        if (mode === "initial") setPhase("error");
      } finally {
        if (mode === "refresh") setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void load("initial");
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetch.current < REFETCH_ON_FOCUS_MS) return;
      void load("refresh");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [load]);

  useEffect(() => {
    document.title = `${copy.mineTitle} | GuessSong`;
  }, [copy.mineTitle]);

  async function onCopy(code: string) {
    const outcome = await copyLink(quizUrl(code));
    reportQuizCopy("owner", outcome);
    if (outcome === "copied") {
      setCopiedCode(code);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), COPIED_FLASH_MS);
    }
  }

  const live = items.filter((q): q is QuizMineSummary => q.status === "ok");
  const ended = items.filter((q) => q.status !== "ok");
  const totalTakers = live.reduce((t, q) => t + q.takers, 0);
  const errorText = error === null ? null : describeError(error, locale, "quiz_board_failed");

  return (
    <Shell>
      <div className="flex w-full max-w-md flex-col gap-8 py-4 sm:max-w-lg">
        <header>
          <p className="text-[11px] uppercase tracking-[0.25em] text-[#666]">GuessSong · Taste Quiz</p>
          <h1 style={{ ...display, fontSize: "clamp(40px, 12vw, 64px)" }} className="mt-2 text-[#f0f0f0]">
            {copy.mineTitle}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[#999]">{copy.mineSubtitle}</p>
        </header>

        {phase === "loading" && <p className="text-sm text-[#999]">{copy.loading}</p>}

        {phase === "empty" && (
          <section className="flex flex-col items-start gap-4">
            <p className="text-sm leading-relaxed text-[#999]">{copy.mineEmpty}</p>
            <Button asChild>
              <Link href={QUIZ_SETUP_HREF}>{copy.mineCreate} →</Link>
            </Button>
          </section>
        )}

        {phase === "error" && (
          <section className="flex flex-col items-start gap-4">
            <p role="alert" className="text-sm text-[#fca5a5]">
              {errorText}
            </p>
            <Button variant="outline" onClick={() => void load("initial")}>
              {copy.retry}
            </Button>
          </section>
        )}

        {phase === "ready" && (
          <>
            <section className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex gap-8">
                <Stat value={live.length} label={copy.mineTotalQuizzes} />
                <Stat value={totalTakers} label={copy.mineTotalTakers} />
              </div>
              <div className="flex items-center gap-3">
                {errorText && (
                  <p role="alert" className="text-xs text-[#f5b942]">
                    {errorText}
                  </p>
                )}
                <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load("refresh")}>
                  {refreshing ? copy.boardRefreshing : copy.boardRefresh}
                </Button>
              </div>
            </section>

            <ul className="flex flex-col gap-3">
              {live.map((q) => {
                const seen = seenAtOpen.current?.[q.code];
                const fresh = seen === undefined ? 0 : q.takers - seen;
                const leader = q.leaders[0];
                // Rounded up, so a quiz made a minute ago reads the week it has.
                const daysLeft = Math.ceil((q.expiresAt - Date.now()) / DAY_MS);
                return (
                  <li key={q.code} className="rounded-xl border border-[#262626] bg-[#1a1a1a] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-[#f0f0f0]">
                          {quizTitle(copy, q.ownerName)}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-[#1DB954]">{q.playlistName}</p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-[#888]">
                        {daysLeft <= 1 ? copy.mineExpiresToday : fillCopy(copy.mineExpiresIn, { days: daysLeft })}
                      </span>
                    </div>

                    <div className="mt-3 flex items-baseline gap-3">
                      <span style={display} className="text-4xl tabular-nums text-[#f0f0f0]">
                        {q.takers}
                      </span>
                      <span className="text-sm text-[#999]">
                        {copy.mineTakersLabel}
                        {q.averageCorrect !== null && (
                          <>
                            {" "}
                            ·{" "}
                            {fillCopy(copy.boardAverage, {
                              avg: q.averageCorrect.toFixed(1),
                              total: q.questionCount,
                            })}
                          </>
                        )}
                      </span>
                      {fresh > 0 && (
                        <span className="rounded-full bg-[rgba(29,185,84,0.15)] px-2 py-0.5 text-xs font-medium text-[#1DB954]">
                          {fillCopy(copy.mineNew, { count: fresh })}
                        </span>
                      )}
                    </div>

                    {q.takers === 0 ? (
                      <p className="mt-2 text-xs text-[#888]">{copy.boardEmpty}</p>
                    ) : (
                      <p className="mt-2 text-xs text-[#888]">
                        {leader &&
                          fillCopy(copy.mineLeader, {
                            name: leader.name,
                            correct: leader.correct,
                            total: leader.total,
                          })}
                        {q.latestAt !== null && (
                          <> · {fillCopy(copy.mineLatest, { when: relativeTime(q.latestAt, locale) })}</>
                        )}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <a href={`/q/${q.code}/board`}>{copy.mineResults}</a>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void onCopy(q.code)}>
                        {copiedCode === q.code ? copy.panelCopied : copy.boardCopyLink}
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a href={`/q/${q.code}`}>{copy.mineOpen}</a>
                      </Button>
                    </div>
                  </li>
                );
              })}

              {ended.map((q) => (
                <li
                  key={q.code}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#1f1f1f] px-4 py-3 text-sm text-[#666]"
                >
                  <span className="font-mono tracking-wider">{q.code}</span>
                  <span>{q.status === "gone" ? copy.mineGone : copy.mineNotHost}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col items-start gap-3">
              <Button asChild variant="outline">
                <Link href={QUIZ_SETUP_HREF}>{copy.mineCreate} →</Link>
              </Button>
              <p className="text-xs leading-relaxed text-[#666]">{copy.mineDeviceNote}</p>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p style={display} className="text-5xl tabular-nums text-[#f0f0f0]">
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-[0.15em] text-[#888]">{label}</p>
    </div>
  );
}
