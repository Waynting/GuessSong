"use client";

/**
 * The quiz as a friend takes it: intro → name → one question per screen →
 * score, verdict, board, and the way out.
 *
 * Modelled on `app/j/[code]/page.tsx`: the person holding this phone never
 * chose a language on this site, so their device decides; every failure is an
 * error code rendered through `describeError`; and the last screen is the one
 * moment they have finished, have nothing left to do, and are still looking —
 * which is where `quiz_result` goes.
 *
 * ## Hints
 *
 * "Guess first, then hear it." The option list is the question; the clip is a
 * rationed hint. It is fetched from `/api/quiz/[code]/hint`, never from
 * `/api/preview` — the phone must not have to name the right answer to ask —
 * and only when tapped, so a quiz opened by twenty friends costs the hottest
 * path in the app nothing until someone is stuck. A clip that cannot be found
 * (`absent` or `unavailable`, and the page does not need to know which) is
 * reported as "no clip" and the hint is *not* spent. Replaying a hint already
 * fetched for this question is free.
 *
 * A hint is a round's async work, and CLAUDE.md's rule applies: it must not
 * land on the next question. `handleHint` takes a `lib/round-token.ts` token
 * before its await and drops the play (keeping the URL, which is still that
 * question's) when "Next" moved on in the meantime — otherwise a cold hint,
 * up to five upstream calls long, started under the following card with the
 * label "that's the song that's in the playlist".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { apiError, describeError } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { foldQuizName, rankOf } from "@/lib/quiz";
import {
  QUIZ_COPY,
  fillCopy,
  formatQuizDate,
  hintWord,
  quizTitle,
  takerShareText,
  type QuizCopy,
} from "@/lib/quiz-copy";
import { createRoundToken } from "@/lib/round-token";
import { COPIED_FLASH_MS, shareLink } from "@/lib/quiz-share";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoopCtaButton } from "@/components/loop-cta";
import {
  QUIZ_NAME_MAX,
  type AnswerQuizRequest,
  type AnswerQuizResponse,
  type QuizView,
} from "@/types/quiz";
import type { PreviewResult } from "@/types/preview";
import { Shell } from "./shell";

type Phase = "loading" | "error" | "intro" | "question" | "submitting" | "result";
type HintState = "idle" | "loading" | "playing" | "none";

/** How many rows of the board to show before collapsing to "…and you". */
const BOARD_ROWS = 10;

export function QuizClient({ code }: { code: string }) {
  const locale = useErrorLocale();
  const copy = QUIZ_COPY[locale];

  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<QuizView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [hintsLeft, setHintsLeft] = useState(0);
  const [hint, setHint] = useState<HintState>("idle");
  const [result, setResult] = useState<AnswerQuizResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Clip URLs already fetched, by question — replaying one is free. */
  const hintUrls = useRef<Map<number, string>>(new Map());
  /** Questions whose hint was charged, so a clip that then fails to play can refund it. */
  const charged = useRef<Set<number>>(new Set());
  /** Questions whose cached URL stopped playing; the next tap asks for a fresh one. */
  const needsRefresh = useRef<Set<number>>(new Set());
  /** One per question on screen; `next()` retires it. See the header. */
  const round = useRef(createRoundToken());
  /** Questions whose clip actually started, so a mid-stream error is not refunded. */
  const heard = useRef<Set<number>>(new Set());
  /**
   * Minted once per attempt. A resend after a lost response carries the same
   * id, and the server replays the row instead of refusing the taker's own
   * name. See `submitQuizAnswers`.
   */
  const submissionId = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  );
  const openedRef = useRef(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch(`/api/quiz/${encodeURIComponent(code)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw apiError(data, "quiz_load_failed");
      const quiz = data as QuizView;
      setView(quiz);
      setAnswers(new Array(quiz.questionCount).fill(-1));
      setHintsLeft(quiz.hintAllowance);
      setPhase("intro");
      if (!openedRef.current) {
        openedRef.current = true;
        trackEvent("quiz_opened", { question_count: quiz.questionCount });
      }
    } catch (e: unknown) {
      setError(describeError(e, locale, "quiz_load_failed"));
      setPhase("error");
    }
    // `locale` is read for the error sentence only; a reload on language
    // change would count a second open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  function stopClip() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  /**
   * A hint the taker could not hear was not a hint: give it back.
   *
   * Two different failures land here and they want different follow-ups. A
   * `play()` refused by the browser (`NotAllowedError` — on iOS the `await
   * fetch` before it is the classic place a tap's gesture gets lost) means the
   * URL is fine: refund, keep the URL, and the next tap plays it. A media
   * failure — the element's `error` event, or `NotSupportedError` — means the
   * CDN rotated the clip: refund, forget the URL, and mark the question so the
   * next tap sends `refresh=1` (lib/preview-cache.ts on why the year-long
   * entries need that). Marking the first case for refresh spent a
   * cache-bypassing, five-call re-resolution on a working URL, and ten of
   * those hit the refresh limiter.
   *
   * A clip that already started is not refunded: the hint was heard.
   */
  function refundHint(question: number, cause: "blocked" | "media") {
    if (heard.current.has(question)) {
      setHint("idle");
      return;
    }
    if (charged.current.delete(question)) {
      setHintsLeft((n) => n + 1);
    }
    if (cause === "media") {
      hintUrls.current.delete(question);
      needsRefresh.current.add(question);
    }
    // A blocked play is not "no clip": the URL is fine and the button beside
    // the caption still offers it, so say nothing rather than the wrong thing.
    setHint(cause === "media" ? "none" : "idle");
  }

  /**
   * `isCurrent` is the round token from the caller; `play()` is one more
   * await the question can move on during. Next's `stopClip()` rejects a
   * still-buffering `play()` with an AbortError, which is neither a media
   * failure nor a blocked gesture: give the hint back and touch nothing on
   * the screen, which by then belongs to the next question.
   */
  async function playUrl(url: string, question: number, isCurrent: () => boolean): Promise<boolean> {
    const audio = audioRef.current;
    if (!audio) return false;
    audio.src = url;
    audio.currentTime = 0;
    try {
      await audio.play();
      if (!isCurrent()) return false;
      setHint("playing");
      return true;
    } catch (e: unknown) {
      const aborted = e instanceof Error && e.name === "AbortError";
      if (aborted || !isCurrent()) {
        if (charged.current.delete(question)) setHintsLeft((n) => n + 1);
        return false;
      }
      const blocked = e instanceof Error && e.name === "NotAllowedError";
      refundHint(question, blocked ? "blocked" : "media");
      return false;
    }
  }

  async function handleHint() {
    if (!view || hint === "loading") return;
    if (hint === "playing") {
      stopClip();
      setHint("idle");
      return;
    }
    const question = index;
    const isCurrent = round.current.begin();
    const cached = hintUrls.current.get(question);
    if (cached) {
      await playUrl(cached, question, isCurrent);
      return;
    }
    if (hintsLeft <= 0) return;
    setHint("loading");
    const refresh = needsRefresh.current.has(question);
    try {
      const res = await fetch(
        `/api/quiz/${encodeURIComponent(code)}/hint?q=${question}${refresh ? "&refresh=1" : ""}`
      );
      const data = (await res.json()) as PreviewResult;
      if (!res.ok || data.status !== "found" || !data.previewUrl) {
        if (isCurrent()) setHint("none");
        return;
      }
      needsRefresh.current.delete(question);
      // The URL is that question's whatever the screen shows now; keep it.
      hintUrls.current.set(question, data.previewUrl);
      if (!isCurrent()) return;
      charged.current.add(question);
      setHintsLeft((n) => n - 1);
      await playUrl(data.previewUrl, question, isCurrent);
    } catch {
      if (isCurrent()) setHint("none");
    }
  }

  function handleClipError() {
    refundHint(index, "media");
  }

  function choose(option: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = option;
      return next;
    });
  }

  async function next() {
    if (!view) return;
    round.current.bump();
    stopClip();
    setHint("idle");
    if (index + 1 < view.questionCount) {
      setIndex(index + 1);
      return;
    }
    await submit();
  }

  async function submit() {
    if (!view) return;
    setPhase("submitting");
    setError(null);
    const body: AnswerQuizRequest = {
      name,
      answers,
      hintsUsed: view.hintAllowance - hintsLeft,
      submissionId: submissionId.current,
    };
    try {
      const res = await fetch(`/api/quiz/${encodeURIComponent(code)}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw apiError(data, "quiz_answer_failed");
      const graded = data as AnswerQuizResponse;
      setResult(graded);
      setPhase("result");
      trackEvent("quiz_completed", {
        question_count: graded.total,
        correct: graded.correct,
        hints_used: graded.hintsUsed,
        verdict: graded.verdict,
      });
    } catch (e: unknown) {
      setError(describeError(e, locale, "quiz_answer_failed"));
      // Back to the name card, answers kept: the usual refusal is a taken
      // name, and that is where the name is. Start returns to the last
      // question, whose button resends.
      setPhase("intro");
    }
  }

  async function handleShare() {
    if (!view || !result) return;
    const url = window.location.href;
    const text = takerShareText(copy, view, result);
    const outcome = await shareLink({ url, text }, `${text} ${url}`);
    if (outcome === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    }
    trackEvent("quiz_share_tapped", { by: "taker", outcome });
  }

  const title = quizTitle(copy, view?.ownerName);
  const expires = view ? fillCopy(copy.expires, { date: formatQuizDate(view.expiresAt, locale) }) : "";

  // One element for the whole quiz, like the game page's single <audio>.
  const audio = (
    <audio
      ref={audioRef}
      preload="none"
      onPlaying={() => heard.current.add(index)}
      onEnded={() => setHint("idle")}
      onError={handleClipError}
    />
  );

  if (phase === "loading") {
    return (
      <Shell>
        <p className="text-center text-sm text-muted-foreground">{copy.loading}</p>
      </Shell>
    );
  }

  if (phase === "error" || !view) {
    return (
      <Shell>
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle>GuessSong</CardTitle>
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

  if (phase === "intro") {
    const canStart = name.trim().length > 0;
    return (
      <Shell>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">GuessSong</p>
            <CardTitle className="text-2xl leading-tight">{title}</CardTitle>
            {!view.ownerName && (
              <p className="text-sm font-medium text-[#1DB954]">{view.playlistName}</p>
            )}
            <CardDescription>
              {fillCopy(copy.introBody, {
                count: view.questionCount,
                hints: view.hintAllowance,
                hintWord: hintWord(locale, view.hintAllowance),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quiz-name">{copy.nameLabel}</Label>
              <Input
                id="quiz-name"
                placeholder={copy.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={QUIZ_NAME_MAX}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canStart) setPhase("question");
                }}
              />
            </div>
            <Button onClick={() => setPhase("question")} disabled={!canStart}>
              {copy.startButton}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {view.scoreboard.length > 0 && (
              <Board view={view} copy={copy} youName={null} />
            )}
            <p className="text-center text-xs text-muted-foreground">{expires}</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === "question" || phase === "submitting") {
    const question = view.questions[index];
    const chosen = answers[index];
    const last = index + 1 === view.questionCount;
    const hasCachedHint = hintUrls.current.has(index);
    const hintLabel =
      hint === "loading"
        ? copy.hintLoading
        : hint === "playing"
          ? copy.hintStop
          : hasCachedHint || hintsLeft > 0
            ? fillCopy(copy.hintButton, { remaining: hintsLeft })
            : copy.hintsGone;
    return (
      <Shell>
        {audio}
        <Card className="w-full max-w-sm">
          <CardHeader>
            <p className="text-xs text-muted-foreground">
              {fillCopy(copy.progress, { n: index + 1, total: view.questionCount })}
            </p>
            <CardTitle className="text-lg leading-snug">
              {view.ownerName
                ? fillCopy(copy.promptOwner, { owner: view.ownerName })
                : copy.promptPlaylist}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* Plain toggle buttons, not ARIA radios: a radio group promises
                arrow-key movement and a roving tabindex, and Tab between four
                buttons is the honest description of what this is. */}
            <div className="flex flex-col gap-2">
              {question.options.map((option, i) => {
                const selected = chosen === i;
                return (
                  <button
                    key={`${index}-${i}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choose(i)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
                      selected
                        ? "border-[#1DB954] bg-[#1DB954]/10"
                        : "border-border bg-secondary/40 hover:bg-secondary"
                    }`}
                  >
                    {/* The selected state is not colour alone. */}
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                        selected ? "border-[#1DB954] bg-[#1DB954] text-black" : "border-muted-foreground"
                      }`}
                    >
                      {selected ? "✓" : ""}
                    </span>
                    <span className="min-w-0">
                      <span className={`block leading-tight ${selected ? "font-semibold" : "font-medium"}`}>
                        {option.title}
                      </span>
                      {option.artist && (
                        <span className="block text-sm text-muted-foreground">{option.artist}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                onClick={() => void handleHint()}
                disabled={
                  hint === "loading" ||
                  phase === "submitting" ||
                  (hint !== "playing" && !hasCachedHint && hintsLeft <= 0)
                }
              >
                <span aria-hidden="true">{hint === "playing" ? "■ " : "🎧 "}</span>
                {hintLabel}
              </Button>
              {hint === "playing" && (
                <p className="text-center text-sm text-[#1DB954]">{copy.hintPlaying}</p>
              )}
              {hint === "none" && (
                <p className="text-center text-sm text-muted-foreground">{copy.hintNone}</p>
              )}
            </div>

            <Button onClick={() => void next()} disabled={chosen < 0 || phase === "submitting"}>
              {phase === "submitting" ? copy.submitting : last ? copy.submitButton : copy.nextButton}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // result
  if (!result) return null;
  const hints = result.hintsUsed;
  return (
    <Shell>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <p className="text-xs text-muted-foreground">{title}</p>
          <CardTitle className="text-5xl font-bold tracking-tight">
            {fillCopy(copy.resultScore, { correct: result.correct, total: result.total })}
          </CardTitle>
          <p className="text-lg font-semibold text-[#1DB954]">{copy.verdicts[result.verdict]}</p>
          {hints > 0 && (
            <CardDescription>
              {fillCopy(copy.hintsUsedLine, { hints, hintWord: hintWord(locale, hints) })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* The board first — it is what the taker came to see and what the
              owner opens the link for. */}
          <Board view={{ ...view, scoreboard: result.scoreboard }} copy={copy} youName={name} />
          {!result.recorded && (
            <p className="text-xs text-muted-foreground">{copy.boardFull}</p>
          )}

          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => void handleShare()}>
              {copied ? copy.copied : copy.shareButton}
            </Button>
            {/* This is the surface. See lib/loop-links.ts, `quiz_result`. */}
            <LoopCtaButton surface="quiz_result">{copy.ctaButton}</LoopCtaButton>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer rounded-md py-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {copy.reviewTitle}
            </summary>
            <ol className="mt-2 flex flex-col gap-2">
              {view.questions.map((q, i) => {
                const right = q.options[result.key[i]];
                const mine = answers[i] >= 0 ? q.options[answers[i]] : null;
                const ok = answers[i] === result.key[i];
                return (
                  <li key={i} className="rounded-md border border-border px-3 py-2">
                    <span className={`font-medium ${ok ? "text-[#1DB954]" : "text-destructive"}`}>
                      {ok ? "✓" : "✗"} {right?.title}
                    </span>
                    {right?.artist && (
                      <span className="text-muted-foreground"> — {right.artist}</span>
                    )}
                    {!ok && mine && (
                      <span className="block text-xs text-muted-foreground line-through">
                        {mine.title}
                        {mine.artist ? ` — ${mine.artist}` : ""}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>

          <p className="text-center text-xs text-muted-foreground">{expires}</p>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Board({
  view,
  copy,
  youName,
}: {
  view: QuizView;
  copy: QuizCopy;
  youName: string | null;
}) {
  const rows = view.scoreboard;
  if (rows.length === 0) return null;
  const youRank = youName ? rankOf(rows, youName) : null;
  const youIndex = youRank === null ? -1 : youRank - 1;
  const you = youName ? foldQuizName(youName) : null;
  const shown = rows.slice(0, BOARD_ROWS);
  const extra = youIndex >= BOARD_ROWS ? rows[youIndex] : null;
  const heading = view.ownerName
    ? fillCopy(copy.boardTitleOwner, { owner: view.ownerName })
    : copy.boardTitlePlaylist;

  const row = (r: QuizView["scoreboard"][number], rank: number) => {
    const isYou = you !== null && foldQuizName(r.name) === you;
    return (
      <li
        key={`${rank}-${r.name}`}
        className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${
          isYou ? "bg-[#1DB954]/15 font-semibold" : ""
        }`}
      >
        <span className="flex items-center gap-2 truncate">
          <span className="w-5 text-muted-foreground">{rank}</span>
          <span className="truncate">{r.name}</span>
          {isYou && <span className="text-xs text-[#1DB954]">({copy.youMarker})</span>}
        </span>
        <span className="tabular-nums">
          {r.correct}/{r.total}
          {r.hintsUsed > 0 && <span className="ml-1 text-xs text-muted-foreground">🎧{r.hintsUsed}</span>}
        </span>
      </li>
    );
  };

  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{heading}</p>
      <ol className="flex flex-col">
        {shown.map((r, i) => row(r, i + 1))}
        {extra && (
          <>
            <li aria-hidden="true" role="presentation" className="px-3 text-xs text-muted-foreground">
              …
            </li>
            {row(extra, youIndex + 1)}
          </>
        )}
      </ol>
    </div>
  );
}
