/**
 * Wire contract for the playlist quiz (/api/quiz/*, /q/[code]).
 *
 * Kept out of lib/quiz-store.ts for the reason types/room.ts gives: the friend's
 * phone imports these to type its fetches, and the store reaches for lib/kv.ts
 * and through it the Upstash client, none of which belongs in a browser bundle.
 */

import type { ErrorLocale } from "@/lib/error-messages";
import type { QuizVerdict } from "@/lib/quiz";

/**
 * Six characters, not the room's four. A room lives thirty minutes and is
 * typed off a television; a quiz link lives a week, is public, and is only
 * ever tapped, so it wants a code space nobody can walk (~887M) and a shape
 * that is visibly not a room code.
 */
export const QUIZ_CODE_LENGTH = 6;

/**
 * Seven days. A link dropped into a group chat is answered within a day or
 * two or not at all, and a week is long enough for the stragglers while
 * keeping the number of live records — and the number of live links — small.
 * Started at thirty and cut on 2026-09-14; the page prints the expiry so
 * nobody is surprised by it either way.
 */
export const QUIZ_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Ten to fifty, any integer, with four one-tap picks. The floor is set by the
 * option count below: with two options a coin flip lands seven of ten 17% of
 * the time, so fewer than ten questions cannot tell a friend from a stranger;
 * at twenty it is 2% and at fifty it is gone. The ceiling is what a cold
 * visitor on a phone in a group chat will finish — fifty two-option taps is a
 * couple of minutes, and the host's own "number of songs" control tops out at
 * 500 only because a party plays through them. The typed field reuses
 * `lib/song-count.ts`'s state machine (`QUIZ_COUNT_CONTROL` in `lib/quiz.ts`),
 * for the same two rules that module exists for.
 */
export const QUIZ_QUESTION_COUNTS = [10, 20, 30, 50] as const;
export const QUIZ_DEFAULT_QUESTION_COUNT = 20;
export const QUIZ_MIN_QUESTIONS = 10;
export const QUIZ_MAX_QUESTIONS = 50;

/**
 * One real track and one decoy per question: a duel, not a list. Two options
 * make the screen the two answers and nothing else, and put chance at 50% —
 * which is why `QUIZ_MIN_QUESTIONS` is ten and `verdictFor`'s lowest passing
 * bucket sits above a coin flip. Four was the first shape and read as a form.
 */
export const QUIZ_OPTION_COUNT = 2;

/**
 * Scoreboard rows one quiz keeps. Past this a taker is still graded and shown
 * their score, they are just not written down — the same "advisory cap, never
 * roll back a winner" rule `lib/room.ts` applies to its roster.
 */
export const QUIZ_MAX_ENTRIES = 50;

/** Same ceiling the room roster applies to a player name. */
export const QUIZ_NAME_MAX = 24;

/** One answer option as the friend sees it. Never carries which one is right. */
export interface QuizOption {
  title: string;
  artist: string;
}

/** A question with its answer key stripped — the only shape a taker receives. */
export interface QuizQuestionView {
  options: QuizOption[];
}

export interface QuizScore {
  name: string;
  correct: number;
  total: number;
  hintsUsed: number;
  /** When the answers landed. The tiebreak after score and hints. */
  at: number;
  /**
   * Indexes of the questions this taker got right. Rides on the same write as
   * the row, so the owner's per-question rates cost nothing extra to keep.
   * Deliberately not which option they picked — that is the guesser's taste
   * profile, and nothing here needs it. Absent on rows written before it.
   */
  right?: number[];
}

export interface QuizView {
  code: string;
  /** Null when the host gave no name; the copy falls back to the playlist. */
  ownerName: string | null;
  playlistName: string;
  questionCount: number;
  hintAllowance: number;
  expiresAt: number;
  questions: QuizQuestionView[];
  /** Public rows: `right` is stripped, see `publicScore`. */
  scoreboard: QuizScore[];
}

export interface CreateQuizRequest {
  url: string;
  ownerName?: string;
  questionCount: number;
  locale?: ErrorLocale;
}

export interface CreateQuizResponse {
  code: string;
  expiresAt: number;
  /** The count actually built, after clamping to the playlist's size. */
  questionCount: number;
  playlistName: string;
  /**
   * Held only by the creator: `lib/quiz-session.ts` keeps it per code in the
   * device's localStorage, and `GET /api/quiz/[code]/board` requires it.
   */
  hostToken: string;
}

export interface AnswerQuizRequest {
  name: string;
  /** Option index per question, in question order. */
  answers: number[];
  hintsUsed?: number;
  /**
   * A random id the phone minted for this attempt, so a resend after a lost
   * response replays the row it already wrote instead of being refused as
   * "someone else has that name" — by its own row. Optional for older pages.
   */
  submissionId?: string;
}

/**
 * One question answered, for the verdict on it. `pick` is required even
 * though the answer does not depend on it: the key for a question is handed
 * over only in exchange for a pick for that question, which is the rule
 * `getQuizView` keeps one step on.
 */
export interface CheckQuizRequest {
  /** Question index. */
  q: number;
  /** Option index the taker chose. */
  pick: number;
}

export interface CheckQuizResponse {
  /** Index of the song that is really in the playlist. Right or wrong is `pick === answer`, the page's to make. */
  answer: number;
}

/** One question as the owner's board shows it: the real song, and how many got it. */
export interface QuizBoardQuestion {
  title: string;
  artist: string;
  /** Takers whose row records per-question results. */
  answered: number;
  correct: number;
}

/** The owner's results page. Host-token gated: it names the answers. */
export interface QuizBoardResponse {
  code: string;
  ownerName: string | null;
  playlistName: string;
  questionCount: number;
  createdAt: number;
  expiresAt: number;
  takers: number;
  /** Mean correct answers across takers, or null with none. */
  averageCorrect: number | null;
  scoreboard: QuizScore[];
  questions: QuizBoardQuestion[];
}

export interface AnswerQuizResponse {
  correct: number;
  total: number;
  hintsUsed: number;
  verdict: QuizVerdict;
  /** The answer key, revealed only now that the answers are in. */
  key: number[];
  /** False when the board was full; the score was still graded and shown. */
  recorded: boolean;
  /** 1-based position on the board, or null when not recorded. */
  rank: number | null;
  scoreboard: QuizScore[];
}
