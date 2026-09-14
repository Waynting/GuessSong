/**
 * What a taker's phone remembers about a quiz: where they are in it, and
 * what they answered once they finished.
 *
 * Both exist because the taker page used to hold everything in component
 * state, and a quiz link is opened from a group chat on a phone — where a
 * reload, a swipe back, or a tab evicted in the background is the ordinary
 * case, not the corner one. A taker who lost fourteen answers to a reload did
 * not start again; they closed the link. And a taker who *did* finish and
 * came back to see the board was refused their own name by the row they had
 * written — the server replays a row whose `submissionId` matches, but only
 * if the phone still has it.
 *
 * Two lists, one entry per quiz code, both in `localStorage` through the
 * same `withStorage` guard `lib/host-session.ts` uses and for the same
 * reasons: storage *throws* in a locked-down browser, and a party guest is
 * not going to debug that. Everything here degrades to "the page works, it
 * just does not remember".
 *
 * Every entry carries the quiz's `expiresAt` and is dropped on read once it
 * passes — the quiz is gone from KV by then and there is nothing to resume.
 * An expiry further out than the TTL allows is corruption, not a longer
 * quiz, the same rule `parseLastQuiz` applies.
 *
 * The history helpers at the bottom are the third thing the page remembers
 * between renders: which question a browser history entry stands for, so the
 * phone's back gesture moves one question rather than leaving the page.
 */

import { withStorage } from "@/lib/host-session";
import { foldQuizName, isAnswerList } from "@/lib/quiz";
import { QUIZ_TTL_SECONDS } from "@/types/quiz";

const PROGRESS_KEY = "guesssong_quiz_progress";
const SUBMISSIONS_KEY = "guesssong_quiz_submissions";

/** Quizzes in progress kept per device. Nobody is mid-way through ten. */
export const QUIZ_PROGRESS_MAX = 10;
/**
 * Finished quizzes kept per device. More than the progress cap because a
 * phone passed round a table finishes one quiz under several names, and each
 * of those people may want their result back.
 */
export const QUIZ_SUBMISSIONS_MAX = 20;

/** The quiz mid-way: enough to put the same question back on screen. */
export interface QuizProgress {
  code: string;
  name: string;
  /** Option index per question, `-1` where not yet answered. */
  answers: number[];
  index: number;
  hintsLeft: number;
  /** Questions whose hint was paid for, so a re-tap after a reload is free. */
  charged: number[];
  /** Carried across a reload so a resend still replays rather than collides. */
  submissionId: string;
  expiresAt: number;
  /** When it was last saved. What pruning orders by. */
  at: number;
}

/** A finished quiz: what the server needs to replay the row it wrote. */
export interface QuizSubmission {
  code: string;
  name: string;
  submissionId: string;
  answers: number[];
  hintsUsed: number;
  expiresAt: number;
  at: number;
}

/** The slice of a `QuizView` the fit checks read. */
export interface QuizShape {
  questionCount: number;
  hintAllowance: number;
  questions: ReadonlyArray<{ options: ReadonlyArray<unknown> }>;
}

/* ------------------------------------------------------------------ */
/* Shared shape rules                                                  */
/* ------------------------------------------------------------------ */

function isCode(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Live and not corrupt: after now, and no further out than a quiz can last. */
function isLiveExpiry(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > now &&
    value <= now + QUIZ_TTL_SECONDS * 1000
  );
}

function isIntList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((a) => Number.isInteger(a));
}

function readAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseList<T>(raw: string | null, parseOne: (item: unknown) => T | null): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    for (const item of value) {
      const parsed = parseOne(item);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}

/** Keeps the `max` most recently saved, by timestamp, in that order. */
export function pruneQuizEntries<T extends { at: number }>(entries: readonly T[], max: number): T[] {
  return [...entries].sort((a, b) => a.at - b.at).slice(Math.max(0, entries.length - max));
}

/* ------------------------------------------------------------------ */
/* In progress                                                         */
/* ------------------------------------------------------------------ */

/**
 * Pure, so the shape rules have a test. Strict about what a resume cannot do
 * without and tolerant of the rest; expired entries are dropped here rather
 * than by a separate sweep, so a read is also the prune.
 */
export function parseQuizProgress(raw: string | null, now = Date.now()): QuizProgress[] {
  return parseList(raw, (item) => {
    if (!item || typeof item !== "object") return null;
    const v = item as Partial<QuizProgress>;
    if (!isCode(v.code)) return null;
    if (!isLiveExpiry(v.expiresAt, now)) return null;
    if (typeof v.name !== "string" || !v.name.trim()) return null;
    if (!isIntList(v.answers)) return null;
    if (!Number.isInteger(v.index) || (v.index as number) < 0) return null;
    if (!Number.isInteger(v.hintsLeft) || (v.hintsLeft as number) < 0) return null;
    if (typeof v.submissionId !== "string" || !v.submissionId) return null;
    return {
      code: v.code.toUpperCase(),
      name: v.name,
      answers: v.answers,
      index: v.index as number,
      hintsLeft: v.hintsLeft as number,
      charged: isIntList(v.charged) ? v.charged : [],
      submissionId: v.submissionId,
      expiresAt: v.expiresAt,
      at: readAt(v.at),
    };
  });
}

/** Replaces this quiz's entry. One per code: a resume is "where was I", not a history. */
export function saveQuizProgress(entry: QuizProgress, now = Date.now()): void {
  withStorage((storage) => {
    const upper = entry.code.toUpperCase();
    const kept = parseQuizProgress(storage.getItem(PROGRESS_KEY), now).filter((e) => e.code !== upper);
    const next = pruneQuizEntries([...kept, { ...entry, code: upper }], QUIZ_PROGRESS_MAX);
    storage.setItem(PROGRESS_KEY, JSON.stringify(next));
  }, undefined);
}

export function recallQuizProgress(code: string, now = Date.now()): QuizProgress | null {
  const upper = code.toUpperCase();
  return withStorage(
    (storage) => parseQuizProgress(storage.getItem(PROGRESS_KEY), now).find((e) => e.code === upper) ?? null,
    null
  );
}

export function clearQuizProgress(code: string, now = Date.now()): void {
  withStorage((storage) => {
    const upper = code.toUpperCase();
    const kept = parseQuizProgress(storage.getItem(PROGRESS_KEY), now).filter((e) => e.code !== upper);
    if (kept.length === 0) storage.removeItem(PROGRESS_KEY);
    else storage.setItem(PROGRESS_KEY, JSON.stringify(kept));
  }, undefined);
}

/**
 * Whether a stored entry describes *this* quiz as the server now serves it.
 * The record is immutable for its week, so a mismatch means the entry is from
 * a different quiz that reused the code, or was hand-edited; either way it is
 * not resumed. Answers are checked against each question's own option count
 * rather than the constant, because a record built before the two-option
 * shape lays out with however many it has.
 */
export function fitsQuizProgress(progress: QuizProgress, quiz: QuizShape): boolean {
  if (progress.answers.length !== quiz.questionCount) return false;
  if (progress.index >= quiz.questionCount) return false;
  if (progress.hintsLeft > quiz.hintAllowance) return false;
  if (!progress.charged.every((q) => q >= 0 && q < quiz.questionCount)) return false;
  return progress.answers.every((a, i) => a >= -1 && a < (quiz.questions[i]?.options.length ?? 0));
}

/* ------------------------------------------------------------------ */
/* Finished                                                            */
/* ------------------------------------------------------------------ */

export function parseQuizSubmissions(raw: string | null, now = Date.now()): QuizSubmission[] {
  return parseList(raw, (item) => {
    if (!item || typeof item !== "object") return null;
    const v = item as Partial<QuizSubmission>;
    if (!isCode(v.code)) return null;
    if (!isLiveExpiry(v.expiresAt, now)) return null;
    if (typeof v.name !== "string" || !v.name.trim()) return null;
    if (typeof v.submissionId !== "string" || !v.submissionId) return null;
    if (!isIntList(v.answers)) return null;
    return {
      code: v.code.toUpperCase(),
      name: v.name,
      submissionId: v.submissionId,
      answers: v.answers,
      hintsUsed: Number.isInteger(v.hintsUsed) && (v.hintsUsed as number) >= 0 ? (v.hintsUsed as number) : 0,
      expiresAt: v.expiresAt,
      at: readAt(v.at),
    };
  });
}

/**
 * Keyed by code *and* folded name, not code alone: a phone passed round a
 * table finishes one quiz under several names, and the second must not
 * overwrite the first person's way back to their result.
 */
export function rememberQuizSubmission(entry: QuizSubmission, now = Date.now()): void {
  withStorage((storage) => {
    const upper = entry.code.toUpperCase();
    const folded = foldQuizName(entry.name);
    const kept = parseQuizSubmissions(storage.getItem(SUBMISSIONS_KEY), now).filter(
      (e) => !(e.code === upper && foldQuizName(e.name) === folded)
    );
    const next = pruneQuizEntries([...kept, { ...entry, code: upper }], QUIZ_SUBMISSIONS_MAX);
    storage.setItem(SUBMISSIONS_KEY, JSON.stringify(next));
  }, undefined);
}

/** This device's finished attempts at one quiz, most recent first. */
export function recallQuizSubmissions(code: string, now = Date.now()): QuizSubmission[] {
  const upper = code.toUpperCase();
  return withStorage(
    (storage) =>
      parseQuizSubmissions(storage.getItem(SUBMISSIONS_KEY), now)
        .filter((e) => e.code === upper)
        .sort((a, b) => b.at - a.at),
    []
  );
}

/** The stored attempt a typed name belongs to, by the server's own fold. */
export function findQuizSubmission(
  submissions: readonly QuizSubmission[],
  name: string
): QuizSubmission | null {
  const folded = foldQuizName(name);
  if (!folded) return null;
  return submissions.find((s) => foldQuizName(s.name) === folded) ?? null;
}

/**
 * Whether a replay of this entry can be accepted: the server grades the
 * resent answers before it looks for the row, so they have to be the shape
 * `isAnswerList` demands or the replay is a 422, not a result.
 */
export function fitsQuizSubmission(submission: QuizSubmission, quiz: Pick<QuizShape, "questionCount">): boolean {
  return isAnswerList(submission.answers, quiz.questionCount);
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/**
 * What a browser history entry stands for while a quiz is being taken.
 *
 * The page pushes one entry per question above the one the link opened on,
 * so the phone's back gesture moves to the previous question instead of
 * leaving the page. `depth` counts the page's own entries up to and
 * including this one — how many `history.back()` calls reach the entry the
 * quiz was opened on — so the result screen can fold them away with one
 * `history.go(-depth)`, and the in-page Back knows whether the entry below
 * is the previous question or the intro.
 *
 * Namespaced under one key and stamped with the code, because Next.js
 * copies its own fields into the same object and a stale entry from another
 * quiz's tab must read as "not ours", never as question three.
 */
export interface QuizHistoryStep {
  step: number;
  depth: number;
}

const HISTORY_KEY = "guesssongQuiz";

export function quizHistoryState(code: string, step: number, depth: number): Record<string, unknown> {
  return { [HISTORY_KEY]: { code: code.toUpperCase(), step, depth } };
}

/** The step a history entry's state describes, or null when it is not this quiz's. */
export function readQuizHistoryStep(state: unknown, code: string): QuizHistoryStep | null {
  if (!state || typeof state !== "object") return null;
  const entry = (state as Record<string, unknown>)[HISTORY_KEY];
  if (!entry || typeof entry !== "object") return null;
  const { code: stored, step, depth } = entry as Partial<{ code: string; step: number; depth: number }>;
  if (typeof stored !== "string" || stored !== code.toUpperCase()) return null;
  if (!Number.isInteger(step) || (step as number) < 0) return null;
  if (!Number.isInteger(depth) || (depth as number) < 1) return null;
  return { step: step as number, depth: depth as number };
}
