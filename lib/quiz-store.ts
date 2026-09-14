/**
 * Server-only storage for the playlist quiz: one Redis hash per quiz.
 *
 *   quiz:v1:<CODE>              hash, TTL QUIZ_TTL_SECONDS (a week)
 *     meta                      { code, ownerName, playlistName, questionCount, locale, createdAt, expiresAt, hostToken }
 *     q                         the questions, answer keys included
 *     s:<folded name>           { name, correct, total, hintsUsed, at, right } — one per taker
 *
 * The shape is `lib/room.ts`'s with one deliberate difference: the payload
 * lives in the hash. Rooms split their tracks into separate keys because a
 * roster poll every few seconds must not drag them across the wire; a quiz is
 * read once per taker and its board is at most fifty rows of a few dozen
 * bytes, so one `hgetall` is the whole read and a second key would be a
 * second command for nothing.
 *
 * The rules that carry over do so for the same reasons they hold there:
 *
 * - **A taker's row is claimed with `hsetnx`, not read-modify-write.** A quiz
 *   link lands in a group chat and several friends open it in the same minute.
 *   One command either wins the name or does not; there is nothing to verify
 *   and nothing to retry.
 * - **`hsetnx` must not touch the TTL.** `createQuiz` calls `expire` once.
 *   Every submission after that leaves the expiry alone, so the board cannot
 *   quietly outlive the `expiresAt` the page printed — and the key is deleted
 *   if `expire` fails, rather than leaking an immortal quiz.
 * - **`foldQuizName` is the only way a name becomes a field.** Two spellings
 *   of the fold would let one person hold two rows.
 * - **The cap is advisory.** Past `QUIZ_MAX_ENTRIES` a taker is still graded
 *   and shown their score — they just are not written down. Rolling back a
 *   winner because a simultaneous submit pushed the count over would turn away
 *   someone who did arrive in time.
 *
 * What is not stored, on purpose: which option a taker picked. `right` records
 * which questions they got, which is what the owner's per-question rates need
 * and costs nothing extra to carry on the row; the wrong choices are the
 * closest thing to a taste profile of the *guesser*, and nothing needs them.
 *
 * ## Why this is not a stateless link
 *
 * `/q/<playlistId>?seed=…` looked like the storage-free option. It is not: the
 * playlist cache is 24h, so every active day of a quiz is a cold Spotify load
 * per quiz, and the thing we want to go up (links opened) becomes the thing
 * that spends the shared quota. It is also not stable — the owner adds a song
 * and question three changes under a board that is comparing scores on
 * different quizzes, and a playlist over MAX_PLAYLIST_TRACKS is a random page
 * sample no seed reproduces. And the board needs KV anyway.
 */

import { randomInt, randomUUID } from "node:crypto";
import { getKvStore } from "@/lib/kv";
import { timingSafeEqualStrings } from "@/lib/timing-safe";
import { getPreview } from "@/lib/preview-cache";
import { errorMessage, type AppErrorCode, type ErrorLocale } from "@/lib/error-messages";
import {
  buildQuiz,
  clampHintsUsed,
  foldQuizName,
  gradeAnswers,
  hintAllowance,
  isAnswerList,
  publicScore,
  rankOf,
  seededRng,
  sortScoreboard,
  stripAnswerKey,
  summarizeBoard,
  verdictFor,
  type DecoyEntry,
  type QuizQuestion,
} from "@/lib/quiz";
import { clampPreviewField, type PreviewResult } from "@/types/preview";
import { CODE_CLAIM_ATTEMPTS, ROOM_CODE_ALPHABET } from "@/types/room";
import {
  QUIZ_CODE_LENGTH,
  QUIZ_MAX_ENTRIES,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_TTL_SECONDS,
  type AnswerQuizResponse,
  type CheckQuizResponse,
  type QuizBoardResponse,
  type QuizScore,
  type QuizView,
} from "@/types/quiz";
import type { Track } from "@/types";

const META_FIELD = "meta";
const QUESTIONS_FIELD = "q";
const SCORE_PREFIX = "s:";

interface QuizMeta {
  code: string;
  ownerName: string | null;
  playlistName: string;
  questionCount: number;
  locale: ErrorLocale;
  createdAt: number;
  expiresAt: number;
  hostToken: string;
}

/**
 * A row as stored. `sid` is the phone's attempt id, kept so a resend after a
 * lost response can be recognised as the same taker rather than refused; it
 * never leaves the server (`publicScore` and the board both drop it).
 */
type StoredScore = QuizScore & { sid?: string };

interface LoadedQuiz {
  meta: QuizMeta;
  questions: QuizQuestion[];
  /** Unsorted; `sortScoreboard` decides order. */
  scores: StoredScore[];
}

/**
 * Same contract as `RoomError`: a code for the wire, English for the logs. No
 * `retryAfterSeconds` — nothing here throttles; a Spotify cooldown reaches the
 * create route as a `SpotifyApiError` and keeps its own.
 */
export class QuizError extends Error {
  readonly params?: Record<string, string | number>;

  constructor(
    readonly code: AppErrorCode,
    readonly status: number,
    options: { params?: Record<string, string | number> } = {}
  ) {
    super(errorMessage(code, "en", { params: options.params }));
    this.name = "QuizError";
    this.params = options.params;
  }
}

/**
 * The one place a code becomes a key, and it takes the *canonical* code only.
 *
 * Every write must key off `quiz.meta.code` (stored canonical), never the
 * route parameter: `loadQuiz` trims and upper-cases, and a write that merely
 * upper-cased sent `/api/quiz/%20ABCDEF/answer` to read the real quiz and then
 * `hsetnx` a row into `quiz:v1: ABCDEF` — a fresh hash no `expire` ever
 * touches, i.e. an immortal orphan per whitespace variant, with the taker told
 * their score was recorded. Confirmed against the store before this guard.
 */
function quizKey(canonicalCode: string): string {
  return `quiz:v1:${canonicalCode}`;
}

function scoreField(name: string): string {
  return `${SCORE_PREFIX}${foldQuizName(name)}`;
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < QUIZ_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Shape check, before any KV command. `/q/[code]` is a public URL, so this is
 * what makes `/q/../..` and a 4k-character segment cost nothing. Returns the
 * canonical (upper-case) code, or null — a link retyped in lower case still
 * opens, as a room code does.
 */
export function normalizeQuizCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  if (upper.length !== QUIZ_CODE_LENGTH) return null;
  return [...upper].every((c) => ROOM_CODE_ALPHABET.includes(c)) ? upper : null;
}

/**
 * Reads the whole quiz as one command and decides whether it still exists.
 * The wall-clock check on `expiresAt` is the same belt-and-braces `loadRoom`
 * wears: the record, not the eviction policy, says when a quiz ends.
 */
async function loadQuiz(rawCode: string): Promise<LoadedQuiz | null> {
  const code = normalizeQuizCode(rawCode);
  if (!code) return null;
  const store = await getKvStore();
  const raw = await store.hgetall<unknown>(quizKey(code));

  const meta = raw[META_FIELD] as QuizMeta | undefined;
  if (!meta || typeof meta.expiresAt !== "number") return null;
  if (Date.now() >= meta.expiresAt) return null;

  const questions = raw[QUESTIONS_FIELD];
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const scores: StoredScore[] = [];
  for (const [field, value] of Object.entries(raw)) {
    if (!field.startsWith(SCORE_PREFIX)) continue;
    const entry = value as StoredScore;
    if (!entry || typeof entry.name !== "string" || typeof entry.correct !== "number") continue;
    scores.push({
      name: entry.name,
      correct: entry.correct,
      total: typeof entry.total === "number" ? entry.total : questions.length,
      hintsUsed: typeof entry.hintsUsed === "number" ? entry.hintsUsed : 0,
      at: typeof entry.at === "number" ? entry.at : 0,
      ...(Array.isArray(entry.right) ? { right: entry.right } : {}),
      ...(typeof entry.sid === "string" ? { sid: entry.sid } : {}),
    });
  }

  return { meta, questions: questions as QuizQuestion[], scores };
}

async function requireQuiz(code: string): Promise<LoadedQuiz> {
  const quiz = await loadQuiz(code);
  if (!quiz) throw new QuizError("quiz_not_found", 404);
  return quiz;
}

export interface CreateQuizInput {
  tracks: readonly Track[];
  questionCount: number;
  ownerName: string | null;
  playlistName: string;
  locale: ErrorLocale;
  pool: readonly DecoyEntry[];
  /** Test seam. Defaults to a random seed; a quiz only has to be stable once built. */
  seed?: number;
}

export interface CreatedQuiz {
  code: string;
  expiresAt: number;
  questionCount: number;
  hostToken: string;
}

/**
 * Builds the questions and claims a code for them.
 *
 * `meta` is the claim: `hsetnx` on a fresh key either creates the quiz or
 * reports the code is taken, in one command. The questions and the expiry
 * follow, and any failure after the claim deletes the key — a hash created by
 * HSETNX has no expiry of its own, and a quiz with no TTL would hold its code
 * forever.
 */
export async function createQuiz(input: CreateQuizInput): Promise<CreatedQuiz> {
  const seed = input.seed ?? randomInt(0, 2 ** 31);
  // buildQuiz dedupes and returns nothing below the minimum; that is the one
  // "too few" decision, made where the dedupe rule lives.
  const questions = buildQuiz({
    tracks: input.tracks,
    questionCount: input.questionCount,
    pool: input.pool,
    rng: seededRng(seed),
  });
  if (questions.length < QUIZ_MIN_QUESTIONS) {
    throw new QuizError("quiz_too_few_tracks", 422, { params: { count: QUIZ_MIN_QUESTIONS } });
  }

  const store = await getKvStore();
  const ownerName = input.ownerName?.trim() || null;

  for (let attempt = 0; attempt < CODE_CLAIM_ATTEMPTS; attempt += 1) {
    const code = generateCode();
    const key = quizKey(code);
    const now = Date.now();
    const meta: QuizMeta = {
      code,
      ownerName,
      playlistName: input.playlistName,
      questionCount: questions.length,
      locale: input.locale,
      createdAt: now,
      expiresAt: now + QUIZ_TTL_SECONDS * 1000,
      hostToken: randomUUID(),
    };
    if (!(await store.hsetnx(key, META_FIELD, meta))) continue;

    try {
      if (!(await store.hsetnx(key, QUESTIONS_FIELD, questions))) {
        // A fresh key cannot already hold questions. Something is stale under
        // this code; do not build on it.
        throw new QuizError("quiz_code_unavailable", 500);
      }
      await store.expire(key, QUIZ_TTL_SECONDS);
    } catch (err) {
      await store.del(key).catch(() => {});
      throw err;
    }
    return {
      code,
      expiresAt: meta.expiresAt,
      questionCount: questions.length,
      hostToken: meta.hostToken,
    };
  }
  throw new QuizError("quiz_code_unavailable", 500);
}

function toView(quiz: LoadedQuiz): QuizView {
  return {
    code: quiz.meta.code,
    ownerName: quiz.meta.ownerName ?? null,
    playlistName: quiz.meta.playlistName,
    questionCount: quiz.questions.length,
    hintAllowance: hintAllowance(quiz.questions.length),
    expiresAt: quiz.meta.expiresAt,
    questions: stripAnswerKey(quiz.questions),
    scoreboard: sortScoreboard(quiz.scores).map(publicScore),
  };
}

/** What a taker's phone receives. Never the answer key. */
export async function getQuizView(code: string): Promise<QuizView> {
  return toView(await requireQuiz(code));
}

/** What the unfurl needs: the card's words, and the canonical code for its URL. */
export interface QuizPeek {
  code: string;
  ownerName: string | null;
  playlistName: string;
  questionCount: number;
  locale: ErrorLocale;
}

/**
 * The bare facts for an unfurl, fail-soft: `generateMetadata` and the card
 * image both run on every fetch of the page, including by the chat app's
 * link preview, and a KV hiccup there must degrade to a generic quiz card
 * rather than a 500. `code` is the stored, canonical one — the page's
 * self-canonical and the image URL are built from it, never from the segment.
 */
export async function peekQuiz(code: string): Promise<QuizPeek | null> {
  try {
    const quiz = await loadQuiz(code);
    if (!quiz) return null;
    return {
      code: quiz.meta.code,
      ownerName: quiz.meta.ownerName ?? null,
      playlistName: quiz.meta.playlistName,
      questionCount: quiz.questions.length,
      locale: quiz.meta.locale === "zh" ? "zh" : "en",
    };
  } catch {
    return null;
  }
}

/**
 * Grades the answers against the stored key and claims a row on the board.
 *
 * Graded before the claim, and the score is returned whether or not the row
 * was written: a taker who arrives at a full board has still taken the quiz.
 *
 * A name collision is not always someone else. The write is one `hsetnx` and
 * the response is a phone on a mobile radio: if the row lands and the reply
 * is lost, the page bounces to the name card and resends the same answers —
 * and would be told "someone has that name" by its own row, with no way to
 * its score short of a second name (and a double count on the board). So the
 * phone mints a `submissionId` per attempt; a collision whose stored `sid`
 * matches replays that row as the answer it was.
 */
export async function submitQuizAnswers(
  code: string,
  name: string,
  answers: unknown,
  hintsUsed: unknown,
  submissionId?: string
): Promise<AnswerQuizResponse> {
  const quiz = await requireQuiz(code);

  const trimmedName = name.trim();
  if (!trimmedName) throw new QuizError("quiz_name_required", 422);
  if (!isAnswerList(answers, quiz.questions.length)) {
    throw new QuizError("quiz_invalid_answers", 422);
  }

  const graded = gradeAnswers(quiz.questions, answers);
  const hints = clampHintsUsed(hintsUsed, quiz.questions.length);
  const folded = foldQuizName(trimmedName);
  const sid = typeof submissionId === "string" && submissionId ? submissionId : undefined;

  const replay = (scores: StoredScore[]): AnswerQuizResponse | null => {
    const mine = scores.find((s) => foldQuizName(s.name) === folded);
    if (!mine) return null;
    if (!sid || mine.sid !== sid) throw new QuizError("quiz_name_taken", 409);
    const scoreboard = sortScoreboard(scores);
    return {
      correct: mine.correct,
      total: mine.total,
      hintsUsed: mine.hintsUsed,
      verdict: verdictFor(mine.correct, mine.total),
      key: graded.key,
      recorded: true,
      rank: rankOf(scoreboard, trimmedName),
      scoreboard: scoreboard.map(publicScore),
    };
  };

  // Advisory, like `assertCanJoin`: the courteous early answer for the common
  // case, with `hsetnx` below as the decision.
  const early = replay(quiz.scores);
  if (early) return early;

  const entry: StoredScore = {
    name: trimmedName,
    correct: graded.correct,
    total: graded.total,
    hintsUsed: hints,
    at: Date.now(),
    right: graded.right,
    ...(sid ? { sid } : {}),
  };

  let recorded = false;
  if (quiz.scores.length < QUIZ_MAX_ENTRIES) {
    const store = await getKvStore();
    // `quiz.meta.code`, never `code`: see quizKey.
    if (!(await store.hsetnx(quizKey(quiz.meta.code), scoreField(trimmedName), entry))) {
      // Lost the race — or this is our own earlier write whose reply was lost.
      const after = await loadQuiz(quiz.meta.code);
      const late = after ? replay(after.scores) : null;
      if (late) return late;
      throw new QuizError("quiz_name_taken", 409);
    }
    recorded = true;
  }

  const scoreboard = sortScoreboard(recorded ? [...quiz.scores, entry] : quiz.scores);
  return {
    correct: graded.correct,
    total: graded.total,
    hintsUsed: hints,
    verdict: verdictFor(graded.correct, graded.total),
    key: graded.key,
    recorded,
    rank: recorded ? rankOf(scoreboard, trimmedName) : null,
    scoreboard: scoreboard.map(publicScore),
  };
}

/**
 * The verdict on one question, in exchange for a pick for it.
 *
 * The taker page shows right or wrong the moment a half is tapped, and the
 * key stays where it was: this hands over the answer to question N only
 * against a pick for question N, and the page locks the question before it
 * asks. What it does not do is *record* the pick — the row on the board is
 * still written once, by `submitQuizAnswers`, from the answers the page
 * kept. So a taker with the network tab open can learn a question's answer
 * and change theirs before the sheet goes in; the same taker could already
 * learn the whole key with one throwaway name, and the store's header
 * concedes that. Stateless on purpose: a pick claimed per question would be
 * a hash per taker with its own TTL, for a party toy.
 *
 * Two KV commands per tap — the route's limiter and one `hgetall` — where a
 * quiz used to cost two per taker. Bounded by the code space (a valid code
 * is the price of admission) and by `QUIZ_CHECK_LIMIT` per address.
 */
export async function checkQuizAnswer(
  code: string,
  questionIndex: number,
  pick: number
): Promise<CheckQuizResponse> {
  // Shape first, before the hash is read, like `getQuizHint`.
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= QUIZ_MAX_QUESTIONS) {
    throw new QuizError("quiz_invalid_answers", 422);
  }
  if (!Number.isInteger(pick) || pick < 0) throw new QuizError("quiz_invalid_answers", 422);
  const quiz = await requireQuiz(code);
  const question = quiz.questions[questionIndex];
  if (!question || pick >= question.options.length) throw new QuizError("quiz_invalid_answers", 422);
  return { answer: question.answer, correct: pick === question.answer };
}

/**
 * The owner's results page: every row, the mean, and per question the real
 * song with how many takers got it.
 *
 * Gated on the host token because it names the answers. The ranking alone is
 * public — the quiz page shows it — but "20% got question three, which was
 * 晴天" is the key, and a friend who reads it before playing has not played.
 * The token lives in the creating device's localStorage (`lib/quiz-session.ts`),
 * the same footing as a room's; there is no account to attach it to.
 */
export async function getQuizBoard(code: string, hostToken: string): Promise<QuizBoardResponse> {
  const quiz = await requireQuiz(code);
  if (!hostToken || !timingSafeEqualStrings(quiz.meta.hostToken, hostToken)) {
    throw new QuizError("quiz_not_host", 403);
  }
  const summary = summarizeBoard(quiz.scores, quiz.questions.length);
  return {
    code: quiz.meta.code,
    ownerName: quiz.meta.ownerName ?? null,
    playlistName: quiz.meta.playlistName,
    questionCount: quiz.questions.length,
    createdAt: quiz.meta.createdAt,
    expiresAt: quiz.meta.expiresAt,
    takers: summary.takers,
    averageCorrect: summary.averageCorrect,
    // The owner sees `right`; the attempt id stays behind either way.
    scoreboard: sortScoreboard(quiz.scores).map((row: StoredScore) => {
      const { sid: _sid, ...rest } = row;
      return rest;
    }),
    questions: quiz.questions.map((q, i) => {
      const real = q.options[q.answer];
      return {
        title: real?.title ?? q.track.name,
        artist: real?.artist ?? q.track.artist,
        answered: summary.perQuestion[i].answered,
        correct: summary.perQuestion[i].correct,
      };
    }),
  };
}

/**
 * A clip of the song that is really in the playlist, for one question.
 *
 * Goes through the server so the taker's phone never learns which option it
 * is asking about: a client that called `/api/preview?track=…` itself would
 * have to name the right answer in the request. The URL that comes back is a
 * CDN address with no title in it.
 *
 * Clamped through `clampPreviewField` like both preview routes, so the lookup
 * lands on the same cache key the game page would write for the same track.
 *
 * `refresh` is the repair path the year-long positive cache needs: the CDN
 * rotates clip URLs, and without it a rotted one is handed back on every tap
 * — charge, `error`, refund, same dead link — for as long as the entry lives.
 * The game page fires it from the `<audio>` element's `error` event; so does
 * the quiz page.
 */
export async function getQuizHint(
  code: string,
  questionIndex: number,
  options: { refresh?: boolean } = {}
): Promise<PreviewResult> {
  // Shape first, before the hash is read — the same rule `normalizeQuizCode`
  // applies to the code on this very call.
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= QUIZ_MAX_QUESTIONS) {
    throw new QuizError("preview_request_invalid", 422);
  }
  const quiz = await requireQuiz(code);
  const question = quiz.questions[questionIndex];
  if (!question) throw new QuizError("preview_request_invalid", 422);
  const { track } = question;
  return getPreview(
    {
      id: track.id,
      track: clampPreviewField(track.name),
      artist: clampPreviewField(track.artist),
      durationMs: track.durationMs > 0 ? track.durationMs : undefined,
    },
    { refresh: Boolean(options.refresh) }
  );
}
