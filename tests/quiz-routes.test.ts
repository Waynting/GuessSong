/**
 * The quiz routes' counters, read back from the store they wrote.
 *
 * `tests/loop-stats.test.ts` pins that each recorder writes the key the reader
 * expects; this pins that each *route* still calls its recorder. A counter
 * that stops being called fails nothing at runtime — the route answers
 * exactly as before and the row in `npm run stats` just stops moving, which
 * reads as "nobody used it". The routes run against the real in-process KV
 * (`lib/kv.ts` with no Upstash env), so what is asserted is the number the
 * script would print, not a mock's call list.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import * as playlistCache from "@/lib/playlist-cache";
import * as previewCache from "@/lib/preview-cache";
import { dayBucket, getKvStore } from "@/lib/kv";
import { LOOP_SURFACES } from "@/lib/loop-links";
import { loopStatsKeys } from "@/lib/loop-stats";
import { POST as createQuiz } from "@/app/api/quiz/route";
import { GET as readQuiz } from "@/app/api/quiz/[code]/route";
import { POST as answerQuiz } from "@/app/api/quiz/[code]/answer/route";
import { POST as checkQuiz } from "@/app/api/quiz/[code]/check/route";
import { GET as hintQuiz } from "@/app/api/quiz/[code]/hint/route";
import { GET as boardQuiz } from "@/app/api/quiz/[code]/board/route";
import type { AnswerQuizResponse, CheckQuizResponse, CreateQuizResponse, QuizView } from "@/types/quiz";
import type { Track } from "@/types";

vi.mock("@/lib/playlist-cache", () => ({ loadPlaylist: vi.fn() }));
vi.mock("@/lib/preview-cache", () => ({ getPreview: vi.fn() }));

/**
 * Pinned to the in-process Map whatever the shell holds. Every other KV test
 * merely *fails* when the Upstash pair leaks into the process (see
 * `tests/kv.test.ts`); this one would pass, and write eleven `quiz:created`
 * and sixty-one `quiz:completed` into the production namespace `npm run
 * stats` reads — the one instrument decisions here are made from. Hoisted so
 * it lands before `lib/kv.ts` first asks.
 */
vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
});

function track(id: string, name: string, artist: string): Track {
  return {
    id,
    name,
    artists: [artist],
    durationMs: 180000 + Number(id) * 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
    popularity: 70,
  };
}

/** Twelve usable tracks: room for a 10-question quiz, and short of a 20. */
const PLAYLIST = [
  track("1", "Die For You", "The Weeknd"),
  track("2", "New Rules", "Dua Lipa"),
  track("3", "Let Down", "Radiohead"),
  track("4", "Come Together", "The Beatles"),
  track("5", "Rolling in the Deep", "Adele"),
  track("6", "Mojito", "周杰倫"),
  track("7", "突然好想你", "五月天"),
  track("8", "Levitating", "Dua Lipa"),
  track("9", "Karma Police", "Radiohead"),
  track("10", "Someone Like You", "Adele"),
  track("11", "Blinding Lights", "The Weeknd"),
  track("12", "小幸運", "田馥甄"),
];

const keys = loopStatsKeys(dayBucket(), LOOP_SURFACES);

async function count(key: string): Promise<number> {
  const store = await getKvStore();
  return (await store.get<number>(key)) ?? 0;
}

/** Each test gets its own address, so the per-IP limiter never crosses tests. */
let ipCounter = 0;
function request(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string>; ip?: string } = {}
): NextRequest {
  const ip = init.ip ?? `10.0.0.${(ipCounter += 1)}`;
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", ip);
  if (init.body) headers.set("content-type", "application/json");
  return new NextRequest(`http://127.0.0.1:8000${url}`, {
    method: init.method,
    body: init.body,
    headers,
  });
}

const params = (code: string) => ({ params: Promise.resolve({ code }) });

async function make(questionCount: number, locale: "en" | "zh" = "en"): Promise<CreateQuizResponse> {
  const res = await createQuiz(
    request("/api/quiz", {
      method: "POST",
      body: JSON.stringify({ url: "https://open.spotify.com/playlist/x", questionCount, locale }),
    })
  );
  expect(res.status).toBe(200);
  return (await res.json()) as CreateQuizResponse;
}

beforeAll(() => {
  vi.mocked(playlistCache.loadPlaylist).mockResolvedValue({
    id: "x",
    name: "Late nights",
    tracks: PLAYLIST,
  } as never);
});

describe("POST /api/quiz", () => {
  it("counts the quiz it built: stage, length, locale — and a clamp when it was shortened", async () => {
    const before = {
      created: await count(keys.quiz.created),
      len10: await count(keys.quizLength.created[10]),
      len12: await count(keys.quizLength.created[12]),
      zh: await count(keys.quizLocale.zh),
      clamped: await count(keys.quizClamped),
    };

    const exact = await make(10, "zh");
    expect(exact.questionCount).toBe(10);
    expect(await count(keys.quiz.created)).toBe(before.created + 1);
    expect(await count(keys.quizLength.created[10])).toBe(before.len10 + 1);
    expect(await count(keys.quizLocale.zh)).toBe(before.zh + 1);
    expect(await count(keys.quizClamped)).toBe(before.clamped);

    // Asked for 20 over a twelve-track playlist: built at 12, filed under 12,
    // and the gap recorded — the panel shows 12 and says nothing about the 20.
    const shortened = await make(20);
    expect(shortened.questionCount).toBe(PLAYLIST.length);
    expect(await count(keys.quizLength.created[12])).toBe(before.len12 + 1);
    expect(await count(keys.quizClamped)).toBe(before.clamped + 1);
  });

  it("counts a refusal at the limiter, per route, and nothing else for it", async () => {
    const before = await count(keys.quizThrottled.create);
    const created = await count(keys.quiz.created);
    const ip = "10.9.9.9";
    // The create limit is ten per window from one address; the eleventh is
    // the refusal. Each of the ten is a real quiz, so `created` moves by ten
    // and then stops.
    for (let i = 0; i < 10; i += 1) {
      const res = await createQuiz(
        request("/api/quiz", {
          method: "POST",
          ip,
          body: JSON.stringify({ url: "https://open.spotify.com/playlist/x", questionCount: 10 }),
        })
      );
      expect(res.status).toBe(200);
    }
    const refused = await createQuiz(
      request("/api/quiz", {
        method: "POST",
        ip,
        body: JSON.stringify({ url: "https://open.spotify.com/playlist/x", questionCount: 10 }),
      })
    );
    expect(refused.status).toBe(429);
    expect(await count(keys.quizThrottled.create)).toBe(before + 1);
    expect(await count(keys.quiz.created)).toBe(created + 10);
  });
});

describe("the taker's routes", () => {
  it("counts an open, a hint by its status, a completion by verdict and length, and a board read", async () => {
    const quiz = await make(10);
    const before = {
      opened: await count(keys.quiz.opened),
      completed: await count(keys.quiz.completed),
      board: await count(keys.quiz.board),
      done10: await count(keys.quizLength.completed[10]),
      found: await count(keys.quizHint.found),
      unavailable: await count(keys.quizHint.unavailable),
      refresh: await count(keys.quizHint.refresh),
      soulmate: await count(keys.quizVerdict.soulmate),
    };

    const opened = await readQuiz(request(`/api/quiz/${quiz.code}`), params(quiz.code));
    expect(opened.status).toBe(200);
    const view = (await opened.json()) as QuizView;
    expect(await count(keys.quiz.opened)).toBe(before.opened + 1);

    // A clip, a throttled minute, and a repair: three requests, four bumps.
    vi.mocked(previewCache.getPreview).mockResolvedValueOnce({ previewUrl: "https://cdn/x.m4a", status: "found" });
    vi.mocked(previewCache.getPreview).mockResolvedValueOnce({ previewUrl: null, status: "unavailable" });
    vi.mocked(previewCache.getPreview).mockResolvedValueOnce({ previewUrl: "https://cdn/y.m4a", status: "found" });
    for (const q of ["0", "1", "2&refresh=1"]) {
      const res = await hintQuiz(request(`/api/quiz/${quiz.code}/hint?q=${q}`), params(quiz.code));
      expect(res.status).toBe(200);
    }
    expect(await count(keys.quizHint.found)).toBe(before.found + 2);
    expect(await count(keys.quizHint.unavailable)).toBe(before.unavailable + 1);
    expect(await count(keys.quizHint.refresh)).toBe(before.refresh + 1);

    // The key is graded server-side; an all-correct sheet needs it, and the
    // hash is the only place it is. Same read `tests/quiz-store.test.ts` does.
    const store = await getKvStore();
    const raw = await store.hgetall<unknown>(`quiz:v1:${quiz.code}`);
    const answers = (raw.q as Array<{ answer: number }>).map((q) => q.answer);
    expect(answers).toHaveLength(view.questionCount);

    const answered = await answerQuiz(
      request(`/api/quiz/${quiz.code}/answer`, {
        method: "POST",
        body: JSON.stringify({ name: "Ann", answers, hintsUsed: 1 }),
      }),
      params(quiz.code)
    );
    expect(answered.status).toBe(200);
    const graded = (await answered.json()) as AnswerQuizResponse;
    expect(graded.verdict).toBe("soulmate");
    expect(await count(keys.quiz.completed)).toBe(before.completed + 1);
    expect(await count(keys.quizVerdict.soulmate)).toBe(before.soulmate + 1);
    expect(await count(keys.quizLength.completed[10])).toBe(before.done10 + 1);

    // Only a token-bearing read is an owner coming back; a guessed URL is not.
    const guessed = await boardQuiz(request(`/api/quiz/${quiz.code}/board`), params(quiz.code));
    expect(guessed.status).toBe(403);
    expect(await count(keys.quiz.board)).toBe(before.board);

    const owner = await boardQuiz(
      request(`/api/quiz/${quiz.code}/board`, { headers: { "x-host-token": quiz.hostToken } }),
      params(quiz.code)
    );
    expect(owner.status).toBe(200);
    expect(await count(keys.quiz.board)).toBe(before.board + 1);
  });

  it("counts a start on the first question's check, once, and no other question's", async () => {
    const quiz = await make(10);
    const before = await count(keys.quiz.started);
    const store = await getKvStore();
    const raw = await store.hgetall<unknown>(`quiz:v1:${quiz.code}`);
    const answers = (raw.q as Array<{ answer: number }>).map((q) => q.answer);

    const check = (q: number, pick: number, ip?: string) =>
      checkQuiz(
        request(`/api/quiz/${quiz.code}/check`, { method: "POST", ip, body: JSON.stringify({ q, pick }) }),
        params(quiz.code)
      );

    // Question zero: the start. The verdict names the answer, against the pick.
    const first = await check(0, answers[0]);
    expect(first.status).toBe(200);
    expect((await first.json()) as CheckQuizResponse).toEqual({ answer: answers[0], correct: true });
    expect(await count(keys.quiz.started)).toBe(before + 1);

    // Every other question: a verdict, not a start.
    for (let q = 1; q < answers.length; q += 1) {
      const res = await check(q, (answers[q] + 1) % 2);
      expect(res.status).toBe(200);
      expect(((await res.json()) as CheckQuizResponse).correct).toBe(false);
    }
    expect(await count(keys.quiz.started)).toBe(before + 1);

    // Refused shapes are refused before anything is counted.
    expect((await check(0, 2)).status).toBe(400);
    expect((await check(50, 0)).status).toBe(400);
    const bare = await checkQuiz(
      request(`/api/quiz/${quiz.code}/check`, { method: "POST", body: JSON.stringify({ q: 0 }) }),
      params(quiz.code)
    );
    expect(bare.status).toBe(400);
    expect(await count(keys.quiz.started)).toBe(before + 1);
    // And a quiz that is not there is a 404 with the code the page reads.
    const gone = await checkQuiz(
      request(`/api/quiz/ZZZZZZ/check`, { method: "POST", body: JSON.stringify({ q: 0, pick: 0 }) }),
      params("ZZZZZZ")
    );
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { code: string }).code).toBe("quiz_not_found");
  });

  it("counts a refused check as a refusal, on its own generous limit", async () => {
    const quiz = await make(10);
    const before = await count(keys.quizThrottled.check);
    const ip = "10.7.7.7";
    // Six hundred per window from one address: a room of phones through a
    // long quiz. The 601st is the refusal, and it is counted as one.
    for (let i = 0; i < 600; i += 1) {
      const res = await checkQuiz(
        request(`/api/quiz/${quiz.code}/check`, { method: "POST", ip, body: JSON.stringify({ q: i % 10, pick: 0 }) }),
        params(quiz.code)
      );
      expect(res.status).toBe(200);
    }
    const refused = await checkQuiz(
      request(`/api/quiz/${quiz.code}/check`, { method: "POST", ip, body: JSON.stringify({ q: 0, pick: 0 }) }),
      params(quiz.code)
    );
    expect(refused.status).toBe(429);
    expect(await count(keys.quizThrottled.check)).toBe(before + 1);
  });

  it("counts a refused answer as a refusal, not a completion", async () => {
    const quiz = await make(10);
    const before = {
      refused: await count(keys.quizThrottled.answer),
      completed: await count(keys.quiz.completed),
    };
    const ip = "10.8.8.8";
    const answers = Array.from({ length: 10 }, () => 0);
    // Sixty per window from one address, then the refusal. The names differ so
    // each of the sixty is a graded sheet and the limiter is what says no.
    for (let i = 0; i < 60; i += 1) {
      const res = await answerQuiz(
        request(`/api/quiz/${quiz.code}/answer`, {
          method: "POST",
          ip,
          body: JSON.stringify({ name: `taker ${i}`, answers }),
        }),
        params(quiz.code)
      );
      expect(res.status).toBe(200);
    }
    const refused = await answerQuiz(
      request(`/api/quiz/${quiz.code}/answer`, {
        method: "POST",
        ip,
        body: JSON.stringify({ name: "the 61st", answers }),
      }),
      params(quiz.code)
    );
    expect(refused.status).toBe(429);
    expect(await count(keys.quizThrottled.answer)).toBe(before.refused + 1);
    expect(await count(keys.quiz.completed)).toBe(before.completed + 60);
  });
});
