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

/**
 * The answer key, read back the way only the server can: the hash is the
 * only place it is, and an all-correct sheet needs it. Same read
 * `tests/quiz-store.test.ts` does.
 */
async function keyFor(code: string): Promise<number[]> {
  const store = await getKvStore();
  const raw = await store.hgetall<unknown>(`quiz:v1:${code}`);
  return (raw.q as Array<{ answer: number }>).map((q) => q.answer);
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

    const answers = await keyFor(quiz.code);
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

  it("counts a finish once, however many times its row is replayed", async () => {
    // "See my result again" and a resend whose reply was lost both re-POST the
    // same submissionId, and the store hands the stored row back. The route
    // used to count every one of those as another completion.
    const quiz = await make(10);
    const before = {
      completed: await count(keys.quiz.completed),
      soulmate: await count(keys.quizVerdict.soulmate),
      done10: await count(keys.quizLength.completed[10]),
    };
    const answers = await keyFor(quiz.code);
    const body = JSON.stringify({ name: "Bea", answers, submissionId: "sub-bea-1" });

    const replies: AnswerQuizResponse[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await answerQuiz(
        request(`/api/quiz/${quiz.code}/answer`, { method: "POST", body }),
        params(quiz.code)
      );
      expect(res.status).toBe(200);
      replies.push((await res.json()) as AnswerQuizResponse);
    }

    expect(await count(keys.quiz.completed)).toBe(before.completed + 1);
    expect(await count(keys.quizVerdict.soulmate)).toBe(before.soulmate + 1);
    expect(await count(keys.quizLength.completed[10])).toBe(before.done10 + 1);
    // The replay is the same answer, and the route's own marker stays on the server.
    for (const reply of replies) {
      expect(reply).toMatchObject({ correct: replies[0].correct, recorded: true });
      expect(reply).not.toHaveProperty("replayed");
    }
  });

  it("counts a start on the first question's check, once, and no other question's", async () => {
    const quiz = await make(10);
    const before = await count(keys.quiz.started);
    const answers = await keyFor(quiz.code);

    const check = (q: number, pick: number) =>
      checkQuiz(
        request(`/api/quiz/${quiz.code}/check`, { method: "POST", body: JSON.stringify({ q, pick }) }),
        params(quiz.code)
      );

    // Question zero: the start. The answer comes back whichever half was picked.
    const first = await check(0, answers[0]);
    expect(first.status).toBe(200);
    expect((await first.json()) as CheckQuizResponse).toEqual({ answer: answers[0] });
    expect(await count(keys.quiz.started)).toBe(before + 1);

    // Every other question: an answer, not a start.
    for (let q = 1; q < answers.length; q += 1) {
      const res = await check(q, (answers[q] + 1) % 2);
      expect(res.status).toBe(200);
      expect((await res.json()) as CheckQuizResponse).toEqual({ answer: answers[q] });
    }
    expect(await count(keys.quiz.started)).toBe(before + 1);

    // Out of range is the store's 422 with the sheet's own code, as on
    // `answer`; a missing field is the parser's 400. Neither is counted.
    for (const [q, pick] of [[0, 2], [50, 0], [-1, 0], [0, -1]]) {
      const res = await check(q, pick);
      expect(res.status, `q=${q} pick=${pick}`).toBe(422);
      expect(((await res.json()) as { code: string }).code).toBe("quiz_invalid_answers");
    }
    const bare = await checkQuiz(
      request(`/api/quiz/${quiz.code}/check`, { method: "POST", body: JSON.stringify({ q: 0 }) }),
      params(quiz.code)
    );
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { code: string }).code).toBe("quiz_missing_fields");
    expect(await count(keys.quiz.started)).toBe(before + 1);
  });

  it("counts no start for a check that answered with anything but a verdict", async () => {
    // `started` is bumped after `checkQuizAnswer` returns, never before: a
    // question-zero check on a quiz that is gone, or past this quiz's own
    // length, or refused by the body parser, or lost to KV is not a friend
    // who played. Each is also the failure the page reads — a `code`, never
    // Next's bare 500 with an empty body.
    const quiz = await make(10);
    const before = await count(keys.quiz.started);
    const store = await getKvStore();
    const post = (code: string, body: string) =>
      checkQuiz(request(`/api/quiz/${code}/check`, { method: "POST", body }), params(code));

    const gone = await post("ZZZZZZ", JSON.stringify({ q: 0, pick: 0 }));
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { code: string }).code).toBe("quiz_not_found");

    // In the schema's range, past this quiz's ten: the store's 422, with its code.
    const past = await post(quiz.code, JSON.stringify({ q: 10, pick: 0 }));
    expect(past.status).toBe(422);
    expect(((await past.json()) as { code: string }).code).toBe("quiz_invalid_answers");

    // Not JSON at all: the same 400 a missing field gets, before any read.
    const hgetall = vi.spyOn(store, "hgetall");
    try {
      const junk = await post(quiz.code, "{not json");
      expect(junk.status).toBe(400);
      expect(((await junk.json()) as { code: string }).code).toBe("quiz_missing_fields");
      expect(hgetall).not.toHaveBeenCalled();
    } finally {
      hgetall.mockRestore();
    }

    // KV down under the read: a coded 500, and the limiter's own `incr`
    // has already said yes so the refusal counter does not move either.
    const down = vi.spyOn(store, "hgetall").mockRejectedValueOnce(new Error("kv down"));
    try {
      const failed = await post(quiz.code, JSON.stringify({ q: 0, pick: 0 }));
      expect(failed.status).toBe(500);
      expect(((await failed.json()) as { code: string }).code).toBe("server_error");
    } finally {
      down.mockRestore();
    }

    expect(await count(keys.quiz.started)).toBe(before);

    // And the verdict itself is never cached by anything between the phone
    // and the route: the key for a question is handed over per request.
    const ok = await post(quiz.code, JSON.stringify({ q: 3, pick: 1 }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
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

    // Its own window, not a sibling's: fifty taps must not spend the sheet's
    // sixty, or the finisher is bounced to the name card — the refusal these
    // counters exist to see. Read and answer from the same address still go.
    const refusedRead = await count(keys.quizThrottled.read);
    const refusedAnswer = await count(keys.quizThrottled.answer);
    expect((await readQuiz(request(`/api/quiz/${quiz.code}`, { ip }), params(quiz.code))).status).toBe(200);
    const sheet = await answerQuiz(
      request(`/api/quiz/${quiz.code}/answer`, {
        method: "POST",
        ip,
        body: JSON.stringify({ name: "after the taps", answers: new Array(10).fill(0) }),
      }),
      params(quiz.code)
    );
    expect(sheet.status).toBe(200);
    expect(await count(keys.quizThrottled.read)).toBe(refusedRead);
    expect(await count(keys.quizThrottled.answer)).toBe(refusedAnswer);
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

describe("where the maker came from", () => {
  const post = (body: Record<string, unknown>) =>
    createQuiz(
      request("/api/quiz", {
        method: "POST",
        body: JSON.stringify({ url: "https://open.spotify.com/playlist/x", questionCount: 10, ...body }),
      })
    );

  /** Every `quiz_from:` count, so "nothing was counted" covers the whole prefix. */
  const allSources = async () =>
    Object.fromEntries(
      await Promise.all(Object.entries(keys.quizFrom).map(async ([s, k]) => [s, await count(k)] as const))
    );

  it("counts the source the page named, once, beside the creation", async () => {
    for (const from of [...LOOP_SURFACES, "internal", "external", "none"] as const) {
      const before = await allSources();
      const created = await count(keys.quiz.created);
      const res = await post({ from });
      expect(res.status, from).toBe(200);
      expect(await count(keys.quiz.created), from).toBe(created + 1);
      expect(await allSources(), from).toEqual({ ...before, [from]: before[from] + 1 });
    }
  });

  it("makes the same quiz and counts no source when the page named none, or one this build does not know", async () => {
    // A measurement riding on a request whose job is making a quiz: a value
    // that is absent, misspelt, from a newer page, or hostile costs the
    // count and never the link. And never a key — the tail is from a body.
    const store = await getKvStore();
    for (const from of [
      undefined,
      "",
      "organic",
      "Internal",
      "https://www.google.com/search?q=secret",
      "quiz_from:none",
      "a".repeat(400),
      7,
      null,
      true,
      ["none"],
      { source: "none" },
    ]) {
      const before = await allSources();
      const created = await count(keys.quiz.created);
      const incr = vi.spyOn(store, "incr");
      try {
        const res = await post(from === undefined ? {} : { from });
        expect(res.status, JSON.stringify(from)).toBe(200);
        const body = (await res.json()) as CreateQuizResponse;
        expect(body.questionCount).toBe(10);
        expect(body.hostToken).toBeTruthy();
        expect(Object.keys(body).sort()).toEqual(["code", "expiresAt", "hostToken", "playlistName", "questionCount"]);
        const written = incr.mock.calls.map(([key]) => String(key));
        expect(written.filter((k) => k.includes("quiz_from")), JSON.stringify(from)).toEqual([]);
      } finally {
        incr.mockRestore();
      }
      expect(await count(keys.quiz.created)).toBe(created + 1);
      expect(await allSources()).toEqual(before);
    }
  });
});

describe("a refetch is not an open", () => {
  it("answers the same view for `?refetch=1` and counts nothing for it", async () => {
    const quiz = await make(10);
    const before = await count(keys.quiz.opened);
    const ownerBefore = await count(keys.quizOwner.owner_opened);

    const first = await readQuiz(request(`/api/quiz/${quiz.code}`), params(quiz.code));
    expect(first.status).toBe(200);
    const view = await first.json();
    expect(await count(keys.quiz.opened)).toBe(before + 1);

    // The result screen's Refresh, as often as it is tapped. Counted under
    // no key at all — the store is watched, not just the two stages.
    const store = await getKvStore();
    const incr = vi.spyOn(store, "incr");
    try {
      for (let i = 0; i < 3; i += 1) {
        const again = await readQuiz(request(`/api/quiz/${quiz.code}?refetch=1`), params(quiz.code));
        expect(again.status).toBe(200);
        expect(again.headers.get("cache-control")).toBe("no-store");
        expect(await again.json()).toEqual(view);
      }
      const counted = incr.mock.calls.map(([key]) => String(key)).filter((k) => k.startsWith("loop:stats:"));
      expect(counted).toEqual([]);
    } finally {
      incr.mockRestore();
    }
    expect(await count(keys.quiz.opened)).toBe(before + 1);
    expect(await count(keys.quizOwner.owner_opened)).toBe(ownerBefore);
  });

  it("counts anything it does not recognise as a real open, so an older page counts as before", async () => {
    const quiz = await make(10);
    const spellings = ["", "?refetch=", "?refetch=0", "?refetch=true", "?refetch=yes", "?refetch=11", "?refetch=1%20", "?Refetch=1", "?refresh=1", "?again=1"];
    const before = await count(keys.quiz.opened);
    for (const query of spellings) {
      const res = await readQuiz(request(`/api/quiz/${quiz.code}${query}`), params(quiz.code));
      expect(res.status, query).toBe(200);
    }
    expect(await count(keys.quiz.opened)).toBe(before + spellings.length);
  });

  it("still limits a refetch like any read, and still answers a gone quiz with its code", async () => {
    // The flag is the caller's word; it buys no free `hgetall`.
    const quiz = await make(10);
    const ip = "10.6.6.6";
    const refused = await count(keys.quizThrottled.read);
    const opened = await count(keys.quiz.opened);
    for (let i = 0; i < 60; i += 1) {
      const res = await readQuiz(request(`/api/quiz/${quiz.code}?refetch=1`, { ip }), params(quiz.code));
      expect(res.status).toBe(200);
    }
    const over = await readQuiz(request(`/api/quiz/${quiz.code}?refetch=1`, { ip }), params(quiz.code));
    expect(over.status).toBe(429);
    expect(await count(keys.quizThrottled.read)).toBe(refused + 1);
    expect(await count(keys.quiz.opened)).toBe(opened);

    const gone = await readQuiz(request("/api/quiz/ZZZZZZ?refetch=1"), params("ZZZZZZ"));
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { code: string }).code).toBe("quiz_not_found");
  });
});

describe("the owner, on their own link", () => {
  const asOwner = (quiz: CreateQuizResponse) => ({ "x-host-token": quiz.hostToken });

  /** The friend-side funnel and the owner's two, read together. */
  const funnel = async () => ({
    opened: await count(keys.quiz.opened),
    started: await count(keys.quiz.started),
    completed: await count(keys.quiz.completed),
    ownerOpened: await count(keys.quizOwner.owner_opened),
    ownerCompleted: await count(keys.quizOwner.owner_completed),
    soulmate: await count(keys.quizVerdict.soulmate),
    stranger: await count(keys.quizVerdict.stranger),
    done10: await count(keys.quizLength.completed[10]),
  });

  it("counts the open as the owner's and not as a friend's", async () => {
    const quiz = await make(10);
    const before = await funnel();
    const res = await readQuiz(request(`/api/quiz/${quiz.code}`, { headers: asOwner(quiz) }), params(quiz.code));
    expect(res.status).toBe(200);
    const view = (await res.json()) as QuizView;
    expect(view.owner).toBe(true);
    expect(await funnel()).toEqual({ ...before, ownerOpened: before.ownerOpened + 1 });

    // And the owner's refetch is nobody's open.
    const again = await readQuiz(
      request(`/api/quiz/${quiz.code}?refetch=1`, { headers: asOwner(quiz) }),
      params(quiz.code)
    );
    expect(((await again.json()) as QuizView).owner).toBe(true);
    expect(await funnel()).toEqual({ ...before, ownerOpened: before.ownerOpened + 1 });
  });

  it("counts a missing or wrong token as a friend, and answers it like one", async () => {
    const quiz = await make(10);
    const other = await make(10);
    const before = await funnel();
    const tokens = ["", "nope", other.hostToken];
    for (const token of tokens) {
      const res = await readQuiz(
        request(`/api/quiz/${quiz.code}`, { headers: { "x-host-token": token } }),
        params(quiz.code)
      );
      expect(res.status, token).toBe(200);
      expect("owner" in ((await res.json()) as QuizView), token).toBe(false);
    }
    expect(await funnel()).toEqual({ ...before, opened: before.opened + tokens.length });
  });

  it("does not count the owner's first question as a friend starting, and answers it the same", async () => {
    const quiz = await make(10);
    const answers = await keyFor(quiz.code);
    const before = await funnel();
    for (let q = 0; q < answers.length; q += 1) {
      const res = await checkQuiz(
        request(`/api/quiz/${quiz.code}/check`, {
          method: "POST",
          headers: asOwner(quiz),
          body: JSON.stringify({ q, pick: 0 }),
        }),
        params(quiz.code)
      );
      expect(res.status).toBe(200);
      // `answer` alone: who asked is the route's business, not the wire's.
      expect(await res.json()).toEqual({ answer: answers[q] });
    }
    expect(await funnel()).toEqual(before);

    // The same question with a token that is not this quiz's is a friend.
    const friend = await checkQuiz(
      request(`/api/quiz/${quiz.code}/check`, {
        method: "POST",
        headers: { "x-host-token": "nope" },
        body: JSON.stringify({ q: 0, pick: 0 }),
      }),
      params(quiz.code)
    );
    expect(await friend.json()).toEqual({ answer: answers[0] });
    expect(await funnel()).toEqual({ ...before, started: before.started + 1 });
  });

  it("grades the owner's sheet, writes no row, and counts it as the owner's alone", async () => {
    const quiz = await make(10);
    const answers = await keyFor(quiz.code);
    const before = await funnel();
    const store = await getKvStore();
    const fields = async () => Object.keys(await store.hgetall<unknown>(`quiz:v1:${quiz.code}`)).sort();
    expect(await fields()).toEqual(["meta", "q"]);

    // No name: the intro asked for none.
    const res = await answerQuiz(
      request(`/api/quiz/${quiz.code}/answer`, {
        method: "POST",
        headers: asOwner(quiz),
        body: JSON.stringify({ name: "", answers, hintsUsed: 0, submissionId: "preview-1" }),
      }),
      params(quiz.code)
    );
    expect(res.status).toBe(200);
    const graded = (await res.json()) as AnswerQuizResponse;
    expect(graded).toMatchObject({ correct: 10, total: 10, verdict: "soulmate", recorded: false, rank: null, preview: true });
    expect(graded.scoreboard).toEqual([]);

    expect(await fields()).toEqual(["meta", "q"]);
    // Not `completed`, not the verdict, not the length table.
    expect(await funnel()).toEqual({ ...before, ownerCompleted: before.ownerCompleted + 1 });

    // A friend's sheet on the same quiz is a friend's: three counters, one row.
    const friend = await answerQuiz(
      request(`/api/quiz/${quiz.code}/answer`, {
        method: "POST",
        body: JSON.stringify({ name: "Ann", answers: answers.map((a) => (a + 1) % 2) }),
      }),
      params(quiz.code)
    );
    expect(friend.status).toBe(200);
    const theirs = (await friend.json()) as AnswerQuizResponse;
    expect(theirs.recorded).toBe(true);
    expect("preview" in theirs).toBe(false);
    expect(await fields()).toEqual(["meta", "q", "s:ann"]);
    expect(await funnel()).toEqual({
      ...before,
      ownerCompleted: before.ownerCompleted + 1,
      completed: before.completed + 1,
      stranger: before.stranger + 1,
      done10: before.done10 + 1,
    });
  });

  it("still asks everyone else for a name, with the reply each of them always got", async () => {
    const quiz = await make(10);
    const answers = await keyFor(quiz.code);
    const before = await funnel();
    const send = (headers: Record<string, string> | undefined, body: Record<string, unknown>) =>
      answerQuiz(
        request(`/api/quiz/${quiz.code}/answer`, { method: "POST", headers, body: JSON.stringify(body) }),
        params(quiz.code)
      );

    // No token: the parser's 400, as before the name's floor left the schema.
    for (const name of ["", "   "]) {
      const res = await send(undefined, { name, answers });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("quiz_missing_fields");
    }
    const missing = await send(undefined, { answers });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { code: string }).code).toBe("quiz_missing_fields");

    // A token that is not this quiz's: a friend, and the store's own code.
    const wrong = await send({ "x-host-token": "nope" }, { name: "", answers });
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { code: string }).code).toBe("quiz_name_required");

    // A name over the cap is still the parser's, owner or not.
    const long = await send(asOwner(quiz), { name: "x".repeat(25), answers });
    expect(long.status).toBe(400);

    expect(await funnel()).toEqual(before);
    const store = await getKvStore();
    expect(Object.keys(await store.hgetall<unknown>(`quiz:v1:${quiz.code}`)).sort()).toEqual(["meta", "q"]);
  });

  it("keys the owner's requests off the canonical code too, and leaves no orphan", async () => {
    // The rule `submitQuizAnswers` keeps for a friend's row, restated for the
    // path that writes nothing: a padded, lower-cased segment reads the real
    // quiz and creates no second hash beside it.
    const quiz = await make(10);
    const answers = await keyFor(quiz.code);
    const segment = ` ${quiz.code.toLowerCase()} `;
    const res = await answerQuiz(
      request(`/api/quiz/${encodeURIComponent(segment)}/answer`, {
        method: "POST",
        headers: asOwner(quiz),
        body: JSON.stringify({ name: "", answers }),
      }),
      params(segment)
    );
    expect(res.status).toBe(200);
    const store = await getKvStore();
    for (const stray of [`quiz:v1:${segment}`, `quiz:v1:${quiz.code.toLowerCase()}`, `quiz:v1:${segment.toUpperCase()}`]) {
      expect(Object.keys(await store.hgetall<unknown>(stray)), stray).toEqual([]);
    }
  });
});
