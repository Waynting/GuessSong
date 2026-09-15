"use client";

/**
 * The quiz as a friend takes it: intro → name → one duel per screen →
 * verdict card, board, and the way out.
 *
 * Modelled on `app/j/[code]/page.tsx`: the person holding this phone never
 * chose a language on this site, so their device decides; every failure is an
 * error code rendered through `describeError`; and the last screen is the one
 * moment they have finished, have nothing left to do, and are still looking —
 * which is where `quiz_result` goes.
 *
 * ## The duel
 *
 * A question is two songs, one real, and the screen is nothing but the two of
 * them: each option is half the viewport, the prompt sits on the seam between
 * them, and a tap answers, shows the verdict, and advances. The first version
 * listed four options under a card title with a Next button, which is a
 * form; fifty of those is a chore, fifty of these is a rhythm.
 *
 * ## The reveal
 *
 * A tap locks the question and asks `POST /api/quiz/[code]/check` for that
 * question's answer — the key still never arrives unasked, it is handed over
 * one question at a time against a pick for it, which is why the halves are
 * disabled the moment one is chosen and why Back shows an answered question
 * rather than reopening it. The chosen half fills white while the server is
 * asked, then green or red — the verdict is painted on the tapped half, so
 * a wrong pick is a red tile and the real song beside it is revealed with a
 * green edge and a tick, never the green fill (the fill is what "right"
 * looks like, and the first version put it on the answer instead: every
 * tap ended with one green tile and nothing red, which read as always
 * green); the seam says which; and the next question slides in after
 * `REVEAL_MS`, long enough to read. A check that does not
 * come back — offline, throttled, slow past `CHECK_TIMEOUT_MS` — costs the
 * verdict and nothing else: the question advances after the plain fill and
 * the sheet is still graded at the end, so a quiz never stalls on a round
 * trip. The last question advances the same way, straight into grading; the
 * score is the end, and the verdicts along the way replaced the answer list
 * the result screen used to fold away.
 *
 * A question revisited — Back, or a reload mid-dwell — is shown locked with
 * its verdict and a Next button, since nothing will advance it by itself.
 *
 * ## Hints
 *
 * "Guess first, then hear it." The two titles are the question; the clip is a
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
 * question's) when the taker moved on in the meantime — otherwise a cold
 * hint, up to five upstream calls long, started under the following question
 * with the caption "that's the song that's in the playlist". Advancing is the
 * round teardown: bump the token, stop the clip, hand the element's `src`
 * back.
 *
 * ## What the phone remembers
 *
 * A quiz link is opened on a phone in a group chat, and there a reload, a
 * swipe back, or a tab evicted in the background is the ordinary case. So
 * the state a question needs — name, answers, the verdicts shown so far,
 * index, hints left, which questions were charged, the `submissionId` — is written to
 * `lib/quiz-progress.ts` on every change and put back on mount, at the same
 * question. Finishing swaps that for the finished row (name, id, answers),
 * which is what lets "See my result again" re-POST and have the server
 * *replay* the row rather than refuse the taker their own name; and what
 * lets Start on the intro tell "you, again" from "someone else has that
 * name" before a single question is answered. Storage that throws — Safari
 * with cookies blocked — costs the memory and nothing else.
 *
 * ## Browser history
 *
 * The phone's back gesture leaves the page unless the page gave it somewhere
 * closer to go. Start pushes an entry and so does every `next()`, one per
 * question, so browser Back and the in-page Back are one code path:
 * `popstate` reads the step the entry stands for (`readQuizHistoryStep`)
 * and goes there through `enterQuestion`, which retires the round first —
 * a hint still resolving when Back fires lands nowhere. Back from the first
 * question is the intro. The result screen folds its own entries away with
 * one `history.go(-depth)`, so Back from there leaves the quiz rather than
 * resurrecting question nineteen under a graded card.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QUIZ_SETUP_HREF } from "@/lib/setup-arrival";
import { trackEvent } from "@/lib/analytics";
import { AppError, apiError, describeError, errorMessage, type AppErrorCode } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { foldQuizName, rankOf, type QuizVerdict } from "@/lib/quiz";
import {
  clearQuizProgress,
  findQuizSubmission,
  fitsQuizProgress,
  fitsQuizSubmission,
  quizHistoryState,
  readQuizHistoryStep,
  recallQuizProgress,
  recallQuizSubmissions,
  rememberQuizSubmission,
  saveQuizProgress,
  type QuizSubmission,
} from "@/lib/quiz-progress";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoopCtaButton } from "@/components/loop-cta";
import {
  QUIZ_NAME_MAX,
  type AnswerQuizRequest,
  type AnswerQuizResponse,
  type CheckQuizRequest,
  type CheckQuizResponse,
  type QuizScore,
  type QuizView,
} from "@/types/quiz";
import type { PreviewResult } from "@/types/preview";
import { Shell } from "./shell";

type Phase = "loading" | "error" | "intro" | "question" | "submitting" | "result";
/**
 * `blocked` is a clip that was found and then refused by the browser — on
 * iOS the `await fetch` between the tap and `play()` is where a gesture
 * gets lost. The URL is fine and the next tap plays it, so the seam says so
 * rather than silently returning the button to "hear a hint".
 */
type HintState = "idle" | "loading" | "playing" | "none" | "blocked";

/** How many rows of the board to show before collapsing to "…and you". */
const BOARD_ROWS = 10;

/**
 * How long the chosen half stays filled before the next question slides in
 * when there is no verdict to show — the check did not come back. Long
 * enough to register as "that one", short enough that fifty of them is a
 * rhythm and not a wait. Matches the CSS transition below.
 */
const FILL_MS = 240;

/**
 * How long the verdict stays on screen before the next question slides in.
 * Long enough to read "nope — it's the other one" and see which; short
 * enough that fifty of them is still a rhythm.
 */
const REVEAL_MS = 1100;

/**
 * How long a check may take before the question advances without a verdict.
 * A phone on a bad radio must not sit on a filled half; the sheet is graded
 * at the end either way.
 */
const CHECK_TIMEOUT_MS = 5000;

/**
 * The verdict card's duotone, keyed by verdict so the five results are five
 * different pictures in the group chat. `guessing` sits between the blue
 * and the grey — a slate that has stopped being a colour without yet being
 * nothing. Never purple on white.
 */
const VERDICT_MESH: Record<QuizVerdict, [string, string]> = {
  soulmate: ["#1DB954", "#0b3d2e"],
  close: ["#f5b942", "#3d2a0b"],
  acquaintance: ["#4f7cff", "#0b1a3d"],
  guessing: ["#7a8fa8", "#141c26"],
  stranger: ["#8a8a8a", "#1c1c1c"],
};

/** A tile of fractal noise for the card's grain. Inline so nothing is fetched. */
const NOISE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

/**
 * Everything the duel and the verdict card look like. One block, rendered
 * once per screen, in a `<style>` because the Tailwind config has no tokens
 * for the display face and the halves want real transitions, not utilities.
 */
const DUEL_CSS = `
  .q-col {
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .q-kicker { font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; color: #777; }
  .q-title { font-size: clamp(40px, 11vw, 64px); text-wrap: balance; }
  .q-playlist { color: #1DB954; font-weight: 500; font-size: 16px; }
  .q-body { color: #aaa; font-size: 15px; line-height: 1.5; }
  .q-muted { color: #666; font-size: 12px; text-align: center; }
  .q-field { background: #1a1a1a; border: 1px solid #333; height: 48px; font-size: 16px; }
  .q-field:focus-visible { border-color: #1DB954; box-shadow: 0 0 0 3px rgba(29,185,84,0.18); }
  .q-primary { height: 48px; font-size: 16px; font-weight: 600; }
  .q-error { color: #ff6b6b; font-size: 14px; }

  .q-progress {
    display: flex; align-items: center; gap: 10px;
    width: 100%; max-width: 480px; margin: 0 auto;
  }
  .q-segments { display: flex; gap: 2px; flex: 1; height: 4px; }
  .q-seg { flex: 1; min-width: 1px; background: #2a2a2a; border-radius: 2px; transition: background 240ms ease-out; }
  /* Right and wrong differ in value, not only hue: a greyscale or a
     red-green-blind eye still reads the tally. */
  .q-seg.is-right { background: #1DB954; }
  .q-seg.is-wrong { background: #e5484d; }
  .q-seg.is-done { background: #555; }
  .q-seg.is-now { background: #f0f0f0; }
  .q-progress-text { font-size: 11px; color: #777; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .q-duel {
    flex: 1; min-height: 0;
    display: grid; gap: 8px;
    width: 100%; max-width: 480px; margin: 0 auto;
    animation: q-in-next ${FILL_MS}ms ease-out both;
  }
  .q-duel.from-back { animation-name: q-in-back; }
  .q-half {
    position: relative;
    display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
    text-align: left; gap: 6px;
    padding: 20px 56px 20px 22px;
    min-height: 30vh; min-height: 30dvh;
    border-radius: 20px;
    border: 1px solid #262626;
    background: #161616;
    color: #f0f0f0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background ${FILL_MS}ms ease-out,
      color ${FILL_MS}ms ease-out,
      opacity ${FILL_MS}ms ease-out,
      border-color ${FILL_MS}ms ease-out;
  }
  .q-half:focus-visible { outline: 2px solid #1DB954; outline-offset: 3px; }
  .q-half:disabled { cursor: default; }
  /* Chosen, verdict on its way: a mid tone with a white edge — no colour
     that says right or wrong yet, and not the brightest thing in a dark
     room fifty times a quiz. The verdict is the first strong fill. */
  .q-half.is-on { background: #2a2a2a; color: #f0f0f0; border-color: #f0f0f0; }
  /* Answered, verdict never came, seen again after Back or a reload. */
  .q-half.is-locked { background: #1e1e1e; color: #f0f0f0; border-color: #555; }
  /* Right and wrong are the two fills, on the half that was tapped; black
     text on both so they differ in hue alone and not in weight. */
  .q-half.is-right { background: #1DB954; color: #000; border-color: #1DB954; }
  .q-half.is-wrong { background: #e5484d; color: #000; border-color: #e5484d; }
  /* The real song under a wrong pick: revealed by its edge and tick, not by
     the green fill — that fill is the right verdict, and on a wrong tap the
     one strong colour on screen has to be the red. */
  .q-half.is-answer { background: #161616; color: #f0f0f0; border-color: #1DB954; box-shadow: inset 0 0 0 1px #1DB954; }
  .q-half.is-off { opacity: 0.4; }
  .q-half-title { font-size: clamp(34px, 9vw, 64px); text-wrap: balance; overflow-wrap: anywhere; }
  .q-half-artist { font-size: 14px; color: #8a8a8a; font-weight: 400; }
  .q-half.is-right .q-half-artist { color: rgba(0,0,0,0.7); }
  .q-half.is-wrong .q-half-artist { color: rgba(0,0,0,0.7); }
  .q-half.is-answer .q-half-artist { color: #1DB954; }
  .q-check {
    position: absolute; top: 14px; right: 16px;
    width: 26px; height: 26px; border-radius: 50%;
    border: 1.5px solid currentColor;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; opacity: 0.3;
  }
  .q-half.is-on .q-check { opacity: 1; background: #f0f0f0; color: #000; border-color: #f0f0f0; }
  .q-half.is-locked .q-check { opacity: 1; background: #555; color: #000; border-color: #555; }
  .q-half.is-right .q-check { opacity: 1; background: #000; color: #1DB954; border-color: #000; }
  .q-half.is-wrong .q-check { opacity: 1; background: #000; color: #e5484d; border-color: #000; }
  .q-half.is-answer .q-check { opacity: 1; background: #1DB954; color: #000; border-color: #1DB954; }

  .q-seam {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 4px 4px; min-height: 48px;
  }
  .q-prompt { font-size: 13px; color: #aaa; line-height: 1.35; flex: 1; }
  .q-prompt.is-live { color: #1DB954; }
  .q-prompt.is-warn { color: #f5b942; }
  .q-prompt.is-wrong { color: #ff6b6b; }
  .q-hint {
    position: relative; flex: none;
    width: 44px; height: 44px; border-radius: 50%;
    border: 1px solid #333; background: #1a1a1a; color: #f0f0f0;
    display: flex; align-items: center; justify-content: center;
    transition: background 160ms ease-out, color 160ms ease-out, opacity 160ms ease-out;
  }
  .q-hint:focus-visible { outline: 2px solid #1DB954; outline-offset: 2px; }
  .q-hint:disabled { opacity: 0.35; }
  .q-hint[aria-pressed="true"] { background: #1DB954; color: #000; border-color: #1DB954; }
  .q-hint-count {
    position: absolute; top: -5px; right: -5px;
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    background: #1DB954; color: #000;
    font-size: 11px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
  }
  .q-hint[aria-pressed="true"] .q-hint-count { background: #000; color: #1DB954; }

  .q-foot {
    display: flex; flex-direction: column; gap: 8px;
    width: 100%; max-width: 480px; margin: 0 auto;
  }
  .q-back {
    align-self: flex-start;
    background: none; border: 0; color: #777; font-size: 14px; padding: 10px 4px;
  }
  .q-back:focus-visible { outline: 2px solid #1DB954; outline-offset: 2px; border-radius: 4px; }

  .q-verdict {
    position: relative; overflow: hidden;
    width: 100%; max-width: 100%;
    aspect-ratio: 9 / 16;
    max-height: 80vh; max-height: 80dvh;
    border-radius: 24px;
    padding: 28px 24px;
    display: flex; flex-direction: column; justify-content: flex-end; gap: 6px;
    color: #fff;
  }
  .q-verdict::after {
    content: ""; position: absolute; inset: 0;
    background-image: url("${NOISE}");
    opacity: 0.14; mix-blend-mode: overlay; pointer-events: none;
  }
  .q-verdict > * { position: relative; z-index: 1; }
  .q-verdict-kicker { font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.75; }
  .q-verdict-label { font-size: clamp(56px, 16vw, 96px); text-wrap: balance; }
  .q-verdict-score { font-size: clamp(28px, 8vw, 40px); font-weight: 600; font-variant-numeric: tabular-nums; }
  .q-verdict-sub { font-size: 15px; opacity: 0.85; }
  .q-verdict-meta { font-size: 13px; opacity: 0.7; }
  .q-brand { position: absolute; top: 22px; left: 24px; font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.7; }
  .q-rise { animation: q-rise 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }

  .q-board-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .q-board-head .q-kicker { margin: 0; }
  .q-refresh {
    background: none; border: 1px solid #333; border-radius: 999px;
    color: #aaa; font-size: 12px; padding: 4px 12px; line-height: 1.4;
  }
  .q-refresh:focus-visible { outline: 2px solid #1DB954; outline-offset: 2px; }
  .q-refresh:disabled { opacity: 0.45; }
  .q-share-url { font-size: 13px; color: #aaa; word-break: break-all; user-select: all; -webkit-user-select: all; text-align: center; }
  .q-home { color: #1DB954; font-size: 16px; font-weight: 600; text-align: center; padding: 12px 0; }
  .q-home:focus-visible { outline: 2px solid #1DB954; outline-offset: 2px; border-radius: 4px; }

  @keyframes q-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes q-in-next { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
  @keyframes q-in-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
`;

export function QuizClient({ code }: { code: string }) {
  const locale = useErrorLocale();
  const copy = QUIZ_COPY[locale];

  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<QuizView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The code behind `error` while the page is in the error phase; decides the way out. */
  const [errorCode, setErrorCode] = useState<AppErrorCode | null>(null);
  const [name, setName] = useState("");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  /** The right option per question once the server has said, `-1` until then. */
  const [revealed, setRevealed] = useState<number[]>([]);
  /**
   * A tap has been made on the question on screen and the advance is on its
   * way — the check in flight, or the verdict dwelling. Off again when the
   * round is retired. While it is on, nothing else on the question is live,
   * and a Next button would only be a second way to do what is about to
   * happen by itself.
   */
  const [pending, setPending] = useState(false);
  const [hintsLeft, setHintsLeft] = useState(0);
  const [hint, setHint] = useState<HintState>("idle");
  const [result, setResult] = useState<AnswerQuizResponse | null>(null);
  const [copied, setCopied] = useState(false);
  /** The page's own URL, shown to copy by hand once neither share nor clipboard worked. */
  const [shareFailedUrl, setShareFailedUrl] = useState<string | null>(null);
  /** The result screen's board, re-read on tap; starts as what grading returned. */
  const [refreshing, setRefreshing] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  /** This device's finished attempts at this quiz, most recent first. */
  const [finished, setFinished] = useState<QuizSubmission[]>([]);
  /** Which way the incoming question slides. Set by `next()` and `back()`. */
  const [enterFrom, setEnterFrom] = useState<"next" | "back">("next");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Clip URLs already fetched, by question — replaying one is free. */
  const hintUrls = useRef<Map<number, string>>(new Map());
  /**
   * Questions whose hint was charged, so a clip that then fails to play can
   * refund it — and, restored from storage after a reload, so a re-tap on a
   * question already paid for fetches without charging twice.
   */
  const charged = useRef<Set<number>>(new Set());
  /** Questions whose cached URL stopped playing; the next tap asks for a fresh one. */
  const needsRefresh = useRef<Set<number>>(new Set());
  /** One per question on screen; `enterQuestion` retires it. See the header. */
  const round = useRef(createRoundToken());
  /** Questions whose clip actually started, so a mid-stream error is not refunded. */
  const heard = useRef<Set<number>>(new Set());
  /** The pending advance after a tap; `back()` and unmount cancel it. */
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The question a tap has locked, read synchronously so a second finger in the same frame is ignored. */
  const locked = useRef<number | null>(null);
  /**
   * `next()` as of the latest render, for the advance timer: it fires a
   * second after the tap, and the `next` it was scheduled with closed over
   * answers that did not yet hold that tap — on the last question that sent
   * a sheet with a `-1` in it. Re-pointed after every render like `onPop`.
   */
  const advance = useRef<() => Promise<void>>(async () => {});
  /**
   * Minted once per attempt, and carried across a reload by the stored
   * progress. A resend after a lost response carries the same id, and the
   * server replays the row instead of refusing the taker's own name. See
   * `submitQuizAnswers`.
   */
  const submissionId = useRef<string>(mintSubmissionId());
  const openedRef = useRef(false);
  /**
   * The `popstate` handler, re-pointed after every render so it closes over
   * the current phase and index without the listener being re-registered.
   * The listener itself is registered once, below.
   */
  const onPop = useRef<(state: unknown) => void>(() => {});

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setErrorCode(null);
    try {
      const quiz = await fetchView(code);
      setView(quiz);
      const done = recallQuizSubmissions(quiz.code).filter((s) => fitsQuizSubmission(s, quiz));
      setFinished(done);
      const progress = recallQuizProgress(quiz.code);
      if (progress && fitsQuizProgress(progress, quiz)) {
        // Back to the same question. The clip URLs are not kept: a re-tap
        // asks the server, whose cache answers, and `charged` makes it free.
        setName(progress.name);
        setAnswers(progress.answers);
        setRevealed(
          progress.revealed.length === quiz.questionCount
            ? progress.revealed
            : new Array<number>(quiz.questionCount).fill(-1)
        );
        setIndex(progress.index);
        setHintsLeft(progress.hintsLeft);
        charged.current = new Set(progress.charged);
        submissionId.current = progress.submissionId;
        pushStep(quiz.code, progress.index);
        setEnterFrom("next");
        setPhase("question");
      } else {
        setAnswers(new Array(quiz.questionCount).fill(-1));
        setRevealed(new Array(quiz.questionCount).fill(-1));
        setHintsLeft(quiz.hintAllowance);
        if (done[0]) setName(done[0].name);
        setPhase("intro");
      }
      if (!openedRef.current) {
        openedRef.current = true;
        trackEvent("quiz_opened", { question_count: quiz.questionCount });
      }
    } catch (e: unknown) {
      setErrorCode(e instanceof AppError ? e.code : "quiz_load_failed");
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

  // Unmount is a round ending too: a check still in flight must not come
  // back and schedule an advance — or, on the last question, a submit — for
  // a page that is gone.
  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      round.current.bump();
    },
    []
  );

  useEffect(() => {
    const handler = (e: PopStateEvent) => onPop.current(e.state);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  /**
   * Every change while a question is on screen is written down. `charged`
   * is a ref, not a dependency, and that is safe because every change to it
   * is paired with one to `hintsLeft` — a charge takes one, a refund gives
   * one back — so the snapshot taken here is never stale by more than the
   * render that carries both. Not while submitting: nothing has changed
   * since the last pick, and a replay from the intro passes through that
   * phase with answers that were never this attempt's.
   */
  useEffect(() => {
    if (!view || phase !== "question") return;
    saveQuizProgress({
      code: view.code,
      name,
      answers,
      revealed,
      index,
      hintsLeft,
      charged: [...charged.current],
      submissionId: submissionId.current,
      expiresAt: view.expiresAt,
      at: Date.now(),
    });
  }, [view, phase, name, answers, revealed, index, hintsLeft]);

  useEffect(() => {
    onPop.current = (state) => {
      if (!view) return;
      const target = readQuizHistoryStep(state, view.code);
      if (phase === "result") {
        // Forward into a question entry after the fold, or Back before it
        // landed: bounce off it to the entry the quiz was opened on.
        if (target) window.history.go(-target.depth);
        return;
      }
      if (phase !== "intro" && phase !== "question") return;
      if (!target) {
        // The entry the link opened on: the intro, answers kept.
        retireRound();
        setPhase("intro");
        return;
      }
      if (target.step >= view.questionCount) return;
      enterQuestion(target.step, target.step < index ? "back" : "next");
    };
  });

  useEffect(() => {
    advance.current = next;
  });

  /**
   * The result folds the quiz's history entries away, so Back leaves rather
   * than resurrecting a question under a graded card. An effect rather than
   * a line in `submit()`: it runs after the commit that re-pointed `onPop`
   * at a closure which knows the phase is `result`, and the `popstate` that
   * `history.go` raises is a task queued after that.
   */
  useEffect(() => {
    if (phase !== "result" || !view) return;
    const current = readQuizHistoryStep(window.history.state, view.code);
    if (current) window.history.go(-current.depth);
  }, [phase, view]);

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
   * URL is fine: refund, keep the URL, say so on the seam, and the next tap
   * plays it. A media failure — the element's `error` event, or
   * `NotSupportedError` — means the CDN rotated the clip: refund, forget the
   * URL, and mark the question so the next tap sends `refresh=1`
   * (lib/preview-cache.ts on why the year-long entries need that). Marking
   * the first case for refresh spent a cache-bypassing, five-call
   * re-resolution on a working URL, and ten of those hit the refresh limiter.
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
    // A blocked play is not "no clip": the URL is fine and the button on the
    // seam still offers it. The seam says the clip did not start and to tap
    // again — silence here read as the button having done nothing.
    setHint(cause === "media" ? "none" : "blocked");
  }

  /**
   * `isCurrent` is the round token from the caller; `play()` is one more
   * await the question can move on during. The teardown's `stopClip()`
   * rejects a still-buffering `play()` with an AbortError, which is neither a
   * media failure nor a blocked gesture: give the hint back and touch nothing
   * on the screen, which by then belongs to the next question.
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
    // A question already paid for — before a reload, say — is fetched again
    // for free; the allowance only gates a *new* charge.
    const paid = charged.current.has(question);
    if (!paid && hintsLeft <= 0) return;
    // Still inside the tap: `load()` on the element counts as the user
    // gesture iOS wants before a later, programmatic `play()` is allowed,
    // and the `await fetch` below is exactly where that gesture used to be
    // lost. Nothing is playing at this point, so this is the same reset the
    // round teardown already performs.
    stopClip();
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
      // Moved on — or answered while the clip was on its way: the verdict is
      // on screen, and a hint under it is a charge for nothing. The URL is
      // kept for a revisit either way.
      if (!isCurrent() || locked.current === question) return;
      if (!paid) {
        charged.current.add(question);
        setHintsLeft((n) => n - 1);
      }
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

  /**
   * The round teardown, shared by every way off a question: cancel a pending
   * advance, bump the token so a hint still resolving lands nowhere, stop the
   * clip and hand the element's `src` back.
   */
  function retireRound() {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    round.current.bump();
    locked.current = null;
    setPending(false);
    stopClip();
    setHint("idle");
  }

  /**
   * The one way onto a question, from Start, `next()`, the in-page Back and
   * the browser's. Retires the round first, whichever way it was left.
   */
  function enterQuestion(step: number, from: "next" | "back") {
    retireRound();
    setError(null);
    setEnterFrom(from);
    setIndex(step);
    setPhase("question");
  }

  /**
   * A tap on a half. Locks the question, records the answer, and goes to ask
   * for the verdict; one tap per question, so a question already answered
   * — revisited, or a second finger — is not re-picked. See "The reveal".
   */
  function pick(option: number) {
    if (!view || phase === "submitting" || answers[index] >= 0 || locked.current === index) return;
    locked.current = index;
    setPending(true);
    choose(option);
    void reveal(index, option, round.current.begin());
  }

  /**
   * The verdict, then the advance. Whatever comes back is kept for the
   * question it was asked about — it is that question's key, and a reload
   * or Back must be able to show it again — but only the question still on
   * screen schedules anything: `isCurrent` is the round token taken at the
   * tap, and a check landing after Back retires the round is a verdict that
   * shows when the question is next revisited, not an advance off whichever
   * question replaced it. No verdict at all still advances, after the plain
   * fill: the sheet is graded at the end either way.
   */
  async function reveal(question: number, option: number, isCurrent: () => boolean) {
    let answer: number | null = null;
    try {
      answer = (await fetchCheck(code, question, option)).answer;
    } catch (e: unknown) {
      // Offline, throttled, timed out, or the quiz is gone. The next question
      // — or grading — will say which of those matters to the taker; the
      // event is for us, since the server only ever sees the refusals.
      trackEvent("quiz_check_lost", { reason: lostCheckReason(e) });
    }
    if (answer !== null) {
      const known = answer;
      setRevealed((prev) => {
        const next = [...prev];
        next[question] = known;
        return next;
      });
    }
    if (!isCurrent()) return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(
      () => {
        advanceTimer.current = null;
        void advance.current();
      },
      answer !== null ? REVEAL_MS : FILL_MS
    );
  }

  async function next() {
    if (!view) return;
    if (index + 1 < view.questionCount) {
      pushStep(view.code, index + 1);
      enterQuestion(index + 1, "next");
      return;
    }
    await submit({
      name,
      answers,
      hintsUsed: view.hintAllowance - hintsLeft,
      submissionId: submissionId.current,
    });
  }

  /**
   * The in-page Back. When the entry below is this quiz's previous question
   * — the ordinary case, one entry per question — it is `history.back()`,
   * and `popstate` does the rest, so the two Backs cannot drift. When it is
   * not (a resume in a fresh tab has only the intro below it), the step is
   * taken in place and the entry rewritten to match.
   */
  function back() {
    if (!view || index === 0 || phase === "submitting") return;
    const current = readQuizHistoryStep(window.history.state, view.code);
    if (current && current.depth >= 2) {
      window.history.back();
      return;
    }
    window.history.replaceState(quizHistoryState(view.code, index - 1, current?.depth ?? 1), "");
    enterQuestion(index - 1, "back");
  }

  /**
   * Start, from the intro. Two checks before a question is shown, both
   * against what the intro already has on screen: a name this phone finished
   * under is a replay, not a refusal; a name someone else finished under is
   * refused here rather than after every question is answered. The server's
   * check stays the authority — a race can still 409, and that path is
   * unchanged.
   */
  function start() {
    if (!view) return;
    const typed = name.trim();
    if (!typed) return;
    const mine = findQuizSubmission(finished, typed);
    if (mine) {
      void replay(mine);
      return;
    }
    const folded = foldQuizName(typed);
    if (view.scoreboard.some((row) => foldQuizName(row.name) === folded)) {
      setError(errorMessage("quiz_name_taken", locale));
      return;
    }
    pushStep(view.code, index);
    enterQuestion(index, "next");
  }

  /** "See my result again": the stored row, re-POSTed so the server replays it. */
  async function replay(mine: QuizSubmission) {
    await submit(
      { name: mine.name, answers: mine.answers, hintsUsed: mine.hintsUsed, submissionId: mine.submissionId },
      { replay: true }
    );
  }

  /**
   * Takes the body explicitly rather than reading state, so a replay can
   * send the stored row without first writing it into the screen: only a
   * graded answer becomes the name, answers and id the result screen shows,
   * and a replay that fails leaves the intro exactly as it was — a new name
   * typed after it starts a fresh attempt, not a walk through someone else's
   * filled-in answers.
   */
  async function submit(body: AnswerQuizRequest, options: { replay?: boolean } = {}) {
    if (!view || phase === "submitting") return;
    setPhase("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/quiz/${encodeURIComponent(code)}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw apiError(data, "quiz_answer_failed");
      const graded = data as AnswerQuizResponse;
      const sid = body.submissionId ?? submissionId.current;
      // The finished row replaces the progress: it is the way back to this
      // screen, and the thing Start compares a typed name against.
      clearQuizProgress(view.code);
      const stored: QuizSubmission = {
        code: view.code,
        name: body.name,
        submissionId: sid,
        answers: body.answers,
        hintsUsed: graded.hintsUsed,
        expiresAt: view.expiresAt,
        at: Date.now(),
      };
      rememberQuizSubmission(stored);
      setFinished((prev) => [stored, ...prev.filter((s) => foldQuizName(s.name) !== foldQuizName(stored.name))]);
      submissionId.current = sid;
      setName(body.name);
      setAnswers(body.answers);
      setResult(graded);
      setBoardError(null);
      setPhase("result");
      // A replay is the same completion seen twice, not a second one.
      if (!options.replay) {
        trackEvent("quiz_completed", {
          question_count: graded.total,
          correct: graded.correct,
          hints_used: graded.hintsUsed,
          verdict: graded.verdict,
        });
      }
    } catch (e: unknown) {
      setError(describeError(e, locale, "quiz_answer_failed"));
      // Back to the name screen, answers kept: the usual refusal is a taken
      // name, and that is where the name is. Start returns to the last
      // question, whose submit button resends.
      setPhase("intro");
    }
  }

  /**
   * The ranking, re-read once per tap. Friends finish while the taker is
   * still looking at the board, and nothing else on this screen changes. No
   * polling: the read limit is sixty per ten minutes per address, and a
   * class is one address. Not an open — `quiz_opened` fired on the first
   * load and `openedRef` keeps it there.
   */
  async function refreshBoard() {
    if (!view || !result || refreshing) return;
    setRefreshing(true);
    setBoardError(null);
    try {
      const fresh = await fetchView(code);
      const scoreboard: QuizScore[] = fresh.scoreboard;
      setResult({
        ...result,
        scoreboard,
        rank: result.recorded ? rankOf(scoreboard, name) : null,
      });
    } catch (e: unknown) {
      setBoardError(describeError(e, locale, "quiz_load_failed"));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleShare() {
    if (!view || !result) return;
    setShareFailedUrl(null);
    const url = window.location.href;
    const text = takerShareText(copy, view, result);
    const outcome = await shareLink({ url, text }, `${text} ${url}`);
    if (outcome === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    } else if (outcome === "failed") {
      setShareFailedUrl(url);
    }
    trackEvent("quiz_share_tapped", { by: "taker", outcome });
  }

  const title = quizTitle(copy, view?.ownerName);
  const expires = view ? fillCopy(copy.expires, { date: formatQuizDate(view.expiresAt, locale) }) : "";
  const styles = <style>{DUEL_CSS}</style>;

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
        {styles}
        <div className="q-col" style={{ flex: 1, justifyContent: "center" }}>
          <p className="q-muted">{copy.loading}</p>
        </div>
      </Shell>
    );
  }

  if (phase === "error" || !view) {
    // A quiz that is gone is gone: retrying a 404 cannot help, and the one
    // thing this visitor can still do is make their own.
    const gone = errorCode === "quiz_not_found";
    return (
      <Shell>
        {styles}
        <div className="q-col" style={{ flex: 1, justifyContent: "center" }}>
          <p className="q-kicker">GuessSong</p>
          <p className="q-body">{error}</p>
          {gone ? (
            <Link href={QUIZ_SETUP_HREF} className="q-home">
              {copy.makeYourOwn}
            </Link>
          ) : (
            <Button variant="outline" className="q-primary" onClick={() => void load()}>
              {copy.retry}
            </Button>
          )}
        </div>
      </Shell>
    );
  }

  if (phase === "intro") {
    const canStart = name.trim().length > 0;
    const mine = finished[0] ?? null;
    return (
      <Shell>
        {styles}
        <section className="q-col" style={{ flex: 1, justifyContent: "center" }}>
          <p className="q-kicker">GuessSong</p>
          <h1 className="q-display q-title">{title}</h1>
          {!view.ownerName && <p className="q-playlist">{view.playlistName}</p>}
          <p className="q-body">
            {fillCopy(copy.introBody, {
              count: view.questionCount,
              hints: view.hintAllowance,
              hintWord: hintWord(locale, view.hintAllowance),
            })}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quiz-name">{copy.nameLabel}</Label>
            <Input
              id="quiz-name"
              className="q-field"
              placeholder={copy.namePlaceholder}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={QUIZ_NAME_MAX}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canStart) start();
              }}
            />
          </div>
          <Button className="q-primary" onClick={start} disabled={!canStart}>
            {copy.startButton}
          </Button>
          {mine && (
            <>
              <Button variant="secondary" className="q-primary" onClick={() => void replay(mine)}>
                {copy.resumeButton}
              </Button>
              <p className="q-muted">{fillCopy(copy.resumeNote, { name: mine.name })}</p>
            </>
          )}
          {error && <p className="q-error">{error}</p>}
          {view.scoreboard.length > 0 && <Board view={view} copy={copy} youName={mine?.name ?? null} />}
          <p className="q-muted">{expires}</p>
        </section>
      </Shell>
    );
  }

  if (phase === "question" || phase === "submitting") {
    const question = view.questions[index];
    const chosen = answers[index];
    /** The right option, once the server has said; `-1` while it has not. */
    const verdict = revealed[index] ?? -1;
    const last = index + 1 === view.questionCount;
    const busy = phase === "submitting";
    /** Answered, and nothing is about to move it: Back, a reload, a refused submit. */
    const parked = chosen >= 0 && !pending && !busy;
    const hasCachedHint = hintUrls.current.has(index);
    // Paid for already (this session or, restored, an earlier one): free to hear.
    // Not once answered: the clip is a hint, and the verdict is on screen.
    const canHear = chosen < 0 && (hasCachedHint || charged.current.has(index) || hintsLeft > 0);
    const hintLabel =
      hint === "loading"
        ? copy.hintLoading
        : hint === "playing"
          ? copy.hintStop
          : canHear
            ? fillCopy(copy.hintButton, { remaining: hintsLeft })
            : copy.hintsGone;
    const hintDisabled = busy || hint === "loading" || (hint !== "playing" && !canHear);
    const prompt = view.ownerName
      ? fillCopy(copy.promptOwner, { owner: view.ownerName })
      : copy.promptPlaylist;
    // One ladder for the seam's words and its colour, so they cannot drift
    // apart: grading outranks the verdict, the verdict outranks "answered,
    // no verdict" (a parked question the check never came back for), which
    // outranks the hint's state (the clip that was playing is the answer now
    // on screen), which outranks the prompt.
    const seam: { text: string; tone: string } = busy
      ? { text: copy.submitting, tone: "" }
      : verdict >= 0
        ? chosen === verdict
          ? { text: copy.revealRight, tone: " is-live" }
          : { text: copy.revealWrong, tone: " is-wrong" }
        : parked
          ? { text: copy.revealPending, tone: "" }
          : hint === "loading"
          ? { text: copy.hintLoading, tone: "" }
          : hint === "playing"
            ? { text: copy.hintPlaying, tone: " is-live" }
            : hint === "none"
              ? { text: copy.hintNone, tone: "" }
              : hint === "blocked"
                ? { text: copy.hintBlocked, tone: " is-warn" }
                : { text: prompt, tone: "" };

    const seamRow = (
      <div className="q-seam" key="seam">
        <p className={`q-prompt${seam.tone}`} aria-live="polite">
          {seam.text}
        </p>
        <button
          type="button"
          className="q-hint"
          aria-label={hintLabel}
          aria-pressed={hint === "playing"}
          disabled={hintDisabled}
          onClick={() => void handleHint()}
        >
          {hint === "playing" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
          ) : hint === "loading" ? (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3" />
              <path d="M9 2.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="0.9s" repeatCount="indefinite" />
              </path>
            </svg>
          ) : (
            <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" fill="currentColor">
              <rect x="1" y="6" width="2" height="4" rx="1" />
              <rect x="5" y="3" width="2" height="10" rx="1" />
              <rect x="9" y="0" width="2" height="16" rx="1" />
              <rect x="13" y="4" width="2" height="8" rx="1" />
              <rect x="17" y="6" width="2" height="4" rx="1" />
            </svg>
          )}
          {hint !== "playing" && hint !== "loading" && canHear && (
            <span className="q-hint-count" aria-hidden="true">
              {hintsLeft}
            </span>
          )}
        </button>
      </div>
    );

    return (
      <Shell>
        {styles}
        {audio}
        <div className="q-progress">
          <div className="q-segments" aria-hidden="true">
            {answers.map((a, i) => (
              <span key={i} className={`q-seg${i === index ? " is-now" : segmentTone(a, revealed[i] ?? -1)}`} />
            ))}
          </div>
          <p className="q-progress-text">
            {fillCopy(copy.progress, { n: index + 1, total: view.questionCount })}
          </p>
        </div>

        {/* Keyed on the question so each one mounts fresh and slides in. The
            halves share the height; the seam takes only its own. Written as
            a template so a record built with more than two options (one from
            before this shape, inside its week) still lays out. */}
        <div
          key={index}
          className={`q-duel${enterFrom === "back" ? " from-back" : ""}`}
          style={{
            gridTemplateRows: question.options.map((_, i) => (i === 0 ? "1fr auto" : "1fr")).join(" "),
          }}
        >
          {question.options.map((option, i) => {
            const selected = chosen === i;
            // The verdict is on the tapped half. The real song under a wrong
            // pick is `answer`: revealed, not dimmed, and never the green fill.
            const right = verdict >= 0 && selected && i === verdict;
            const wrong = verdict >= 0 && selected && i !== verdict;
            const answer = verdict >= 0 && !selected && i === verdict;
            const dimmed = chosen >= 0 && !selected && !answer;
            // Selected reads as "on its way" while the check is out and as
            // "locked" once it is plainly not coming — a parked question.
            const tone = right ? " is-right" : wrong ? " is-wrong" : answer ? " is-answer" : selected ? (parked ? " is-locked" : " is-on") : "";
            return [
              /* Plain toggle buttons, not ARIA radios: a radio group promises
                 arrow-key movement and a roving tabindex, and Tab between the
                 halves is the honest description of what this is. Disabled
                 once answered: one tap per question, see "The reveal". */
              <button
                key={`${index}-${i}`}
                type="button"
                aria-pressed={selected}
                disabled={busy || chosen >= 0}
                onClick={() => pick(i)}
                className={`q-half${tone}${dimmed ? " is-off" : ""}`}
              >
                {/* Neither the selected state nor the verdict is colour alone. */}
                <span className="q-check" aria-hidden="true">
                  {right || answer ? "✓" : wrong ? "✗" : ""}
                </span>
                <span className="q-display q-half-title">{option.title}</span>
                {option.artist && <span className="q-half-artist">{option.artist}</span>}
              </button>,
              i === 0 ? seamRow : null,
            ];
          })}
        </div>

        <div className="q-foot">
          {/* Only a parked question needs a button: the ordinary advance
              happens by itself. On the last one it is the resend after a
              refused submit. */}
          {parked && (
            <Button className="q-primary" onClick={() => void next()}>
              {last ? copy.submitButton : copy.nextButton}
            </Button>
          )}
          {error && <p className="q-error">{error}</p>}
          {index > 0 && (
            <button type="button" className="q-back" onClick={back} disabled={busy || pending}>
              ← {copy.backButton}
            </button>
          )}
        </div>
      </Shell>
    );
  }

  // result
  if (!result) return null;
  const hints = result.hintsUsed;
  const [meshA, meshB] = VERDICT_MESH[result.verdict];
  const subject = view.ownerName
    ? fillCopy(copy.resultSubjectOwner, { owner: view.ownerName })
    : fillCopy(copy.resultSubjectPlaylist, { playlist: view.playlistName });
  return (
    <Shell>
      {styles}
      <section className="q-col">
        {/* The card is the deliverable: it is shaped to be screenshotted
            straight into the chat the link came from. */}
        <div
          className="q-verdict"
          style={{
            background: `radial-gradient(120% 90% at 18% 12%, ${meshA} 0%, ${meshB} 62%, #0a0a0a 100%)`,
          }}
        >
          <span className="q-brand q-rise" style={{ animationDelay: "0ms" }}>
            GuessSong
          </span>
          <p className="q-verdict-kicker q-rise" style={{ animationDelay: "80ms" }}>
            {copy.resultKicker}
          </p>
          <p className="q-display q-verdict-label q-rise" style={{ animationDelay: "200ms" }}>
            {copy.verdicts[result.verdict]}
          </p>
          <p className="q-verdict-score q-rise" style={{ animationDelay: "340ms" }}>
            {fillCopy(copy.resultScore, { correct: result.correct, total: result.total })}
          </p>
          <p className="q-verdict-sub q-rise" style={{ animationDelay: "440ms" }}>
            {subject}
          </p>
          {result.rank !== null && (
            <p className="q-verdict-meta q-rise" style={{ animationDelay: "540ms" }}>
              {fillCopy(copy.rankLine, { rank: result.rank, count: result.scoreboard.length })}
            </p>
          )}
          {hints > 0 && (
            <p className="q-verdict-meta q-rise" style={{ animationDelay: "600ms" }}>
              {fillCopy(copy.hintsUsedLine, { hints, hintWord: hintWord(locale, hints) })}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="secondary" className="q-primary" onClick={() => void handleShare()}>
            {copied ? copy.copied : copy.shareButton}
          </Button>
          {shareFailedUrl && (
            <>
              <p className="q-muted" role="status">
                {copy.shareFailed}
              </p>
              <p className="q-share-url">{shareFailedUrl}</p>
            </>
          )}
          {/* This is the surface. See lib/loop-links.ts, `quiz_result`. */}
          <LoopCtaButton surface="quiz_result">{copy.makeYourOwn}</LoopCtaButton>
        </div>

        {/* The board next — it is what the taker came to see and what the
            owner opens the link for. */}
        <Board
          view={{ ...view, scoreboard: result.scoreboard }}
          copy={copy}
          youName={name}
          action={
            <button
              type="button"
              className="q-refresh"
              onClick={() => void refreshBoard()}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              {refreshing ? copy.refreshingBoard : copy.refreshBoard}
            </button>
          }
        />
        {boardError && <p className="q-error">{boardError}</p>}
        {!result.recorded && <p className="q-muted">{copy.boardFull}</p>}

        {/* No answer list here: every question said right or wrong as it
            was answered, and the score is the end. */}
        <p className="q-muted">{expires}</p>
      </section>
    </Shell>
  );
}

/**
 * A progress segment's colour for a question behind the taker: nothing until
 * answered, `is-done` while the verdict never arrived, then right or wrong
 * by the same comparison the halves make.
 */
function segmentTone(answer: number, verdict: number): string {
  if (answer < 0) return "";
  if (verdict < 0) return " is-done";
  return verdict === answer ? " is-right" : " is-wrong";
}

/**
 * Makes the current history entry stand for `step`, pushing one when it does
 * not already. The check is what keeps Start after a refused name — still on
 * the last question's entry — from stacking a second entry for the same
 * question, which would have made Back a no-op. No URL: the entry is the
 * same page, and Next.js copies its own router state into whatever is pushed.
 */
function pushStep(quizCode: string, step: number) {
  const current = readQuizHistoryStep(window.history.state, quizCode);
  if (current && current.step === step) return;
  window.history.pushState(quizHistoryState(quizCode, step, (current?.depth ?? 0) + 1), "");
}

/** One `GET /api/quiz/[code]`: the first load, a retry, and the board refresh share it. */
async function fetchView(code: string): Promise<QuizView> {
  const res = await fetch(`/api/quiz/${encodeURIComponent(code)}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw apiError(data, "quiz_load_failed");
  return data as QuizView;
}

/**
 * One `POST /api/quiz/[code]/check`: the verdict on a question, against a
 * pick for it. Times out on its own so a phone on a bad radio is not left
 * on a filled half; every failure is the caller's "no verdict".
 */
async function fetchCheck(code: string, q: number, pick: number): Promise<CheckQuizResponse> {
  const body: CheckQuizRequest = { q, pick };
  const res = await fetch(`/api/quiz/${encodeURIComponent(code)}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: checkTimeout(),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch (e: unknown) {
    // The timeout can land here too — headers in, body stalled — and it must
    // stay a timeout. Otherwise: a bare 500 with an empty body is the server;
    // a 200 that is not JSON is the wire. Named so `lostCheckReason` can file them.
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw e;
    throw new Error(res.ok ? "check: malformed" : "check: server");
  }
  if (!res.ok) throw apiError(data, "quiz_answer_failed");
  const check = data as Partial<CheckQuizResponse>;
  if (!Number.isInteger(check.answer)) throw new Error("check: malformed");
  return { answer: check.answer as number };
}

/**
 * Which bucket a failed check lands in, for `quiz_check_lost`. `apiError`
 * carries the server's code; an abort is the timeout above; anything else
 * that threw before a response is the network.
 */
function lostCheckReason(e: unknown): "timeout" | "offline" | "rate_limited" | "server" | "malformed" {
  if (e instanceof AppError) return e.code === "rate_limited" ? "rate_limited" : "server";
  if (e instanceof Error && e.name === "TimeoutError") return "timeout";
  if (e instanceof Error && e.message === "check: malformed") return "malformed";
  if (e instanceof Error && e.message === "check: server") return "server";
  return "offline";
}

/** `AbortSignal.timeout` where the browser has it; a browser without it just waits. */
function checkTimeout(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(CHECK_TIMEOUT_MS)
    : undefined;
}

function mintSubmissionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function Board({
  view,
  copy,
  youName,
  action,
}: {
  view: QuizView;
  copy: QuizCopy;
  youName: string | null;
  /** A control on the heading's row — the result screen's refresh. */
  action?: React.ReactNode;
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
          <span className="w-5 text-[#777]">{rank}</span>
          <span className="truncate">{r.name}</span>
          {isYou && <span className="text-xs text-[#1DB954]">({copy.youMarker})</span>}
        </span>
        <span className="tabular-nums">
          {r.correct}/{r.total}
          {r.hintsUsed > 0 && <span className="ml-1 text-xs text-[#777]">🎧{r.hintsUsed}</span>}
        </span>
      </li>
    );
  };

  return (
    <div>
      <div className="q-board-head">
        <p className="q-kicker">{heading}</p>
        {action}
      </div>
      <ol className="flex flex-col">
        {shown.map((r, i) => row(r, i + 1))}
        {extra && (
          <>
            <li aria-hidden="true" role="presentation" className="px-3 text-xs text-[#777]">
              …
            </li>
            {row(extra, youIndex + 1)}
          </>
        )}
      </ol>
    </div>
  );
}
