import { describe, it, expect, vi, beforeEach } from "vitest";
import * as previewCache from "@/lib/preview-cache";
import { getKvStore } from "@/lib/kv";
import {
  checkQuizAnswer,
  createQuiz,
  getQuizBoard,
  getQuizHint,
  getQuizView,
  normalizeQuizCode,
  peekQuiz,
  submitQuizAnswers,
  QuizError,
} from "@/lib/quiz-store";
import { QUIZ_DECOY_POOL } from "@/lib/quiz-decoys";
import { PREVIEW_FIELD_MAX } from "@/types/preview";
import {
  QUIZ_CODE_LENGTH,
  QUIZ_MAX_ENTRIES,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_NAME_MAX,
  QUIZ_OPTION_COUNT,
  QUIZ_TTL_SECONDS,
} from "@/types/quiz";
import type { Track } from "@/types";

vi.mock("@/lib/preview-cache", () => ({
  getPreview: vi.fn(),
}));

function track(id: string, name: string, artist: string): Track {
  return { id, name, artists: [artist], durationMs: 180000 + Number(id) * 1000, createdAt: "2026-01-01T00:00:00.000Z", popularity: 70 };
}

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

async function make(overrides: Partial<Parameters<typeof createQuiz>[0]> = {}) {
  return createQuiz({
    tracks: PLAYLIST,
    questionCount: 10,
    ownerName: "Wayn",
    playlistName: "Late nights",
    locale: "zh",
    pool: QUIZ_DECOY_POOL,
    seed: 7,
    ...overrides,
  });
}

/** The answer key, read back the way only the server can. */
async function keyFor(code: string): Promise<number[]> {
  const store = await getKvStore();
  const raw = await store.hgetall<unknown>(`quiz:v1:${code}`);
  return (raw.q as Array<{ answer: number }>).map((q) => q.answer);
}

beforeEach(() => {
  vi.mocked(previewCache.getPreview).mockReset();
});

describe("createQuiz", () => {
  it("claims a six-character code with a one-week expiry and a host token", async () => {
    const created = await make();
    expect(created.code).toHaveLength(QUIZ_CODE_LENGTH);
    expect(normalizeQuizCode(created.code)).toBe(created.code);
    expect(created.questionCount).toBe(10);
    expect(created.hostToken).toBeTruthy();
    expect(created.expiresAt).toBeGreaterThan(Date.now() + (QUIZ_TTL_SECONDS - 60) * 1000);
    expect(created.expiresAt).toBeLessThanOrEqual(Date.now() + QUIZ_TTL_SECONDS * 1000);
  });

  it("refuses a playlist too short for the minimum, naming the number", async () => {
    await expect(make({ tracks: PLAYLIST.slice(0, 3) })).rejects.toMatchObject({
      code: "quiz_too_few_tracks",
      status: 422,
      params: { count: QUIZ_MIN_QUESTIONS },
    });
  });

  it("clamps the count to the playlist and reports what it built", async () => {
    const created = await make({ questionCount: 20 });
    expect(created.questionCount).toBe(PLAYLIST.length);
  });

  it("deletes the claim rather than leak an immortal key when expire fails", async () => {
    const store = await getKvStore();
    const expire = vi.spyOn(store, "expire").mockRejectedValueOnce(new Error("kv down"));
    const del = vi.spyOn(store, "del");
    await expect(make()).rejects.toThrow("kv down");
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toMatch(/^quiz:v1:/);
    expire.mockRestore();
    del.mockRestore();
  });

  it("stores a blank owner as null so the copy can fall back to the playlist", async () => {
    const created = await make({ ownerName: "   " });
    const view = await getQuizView(created.code);
    expect(view.ownerName).toBeNull();
    expect(view.playlistName).toBe("Late nights");
  });

  it("draws another code when the first is taken, and gives up after five", async () => {
    // `hsetnx` on `meta` is the claim. A false means the code is live under
    // someone else's quiz, and the only correct move is a fresh code — never a
    // write on top of theirs.
    const store = await getKvStore();
    const real = store.hsetnx.bind(store);
    const hsetnx = vi.spyOn(store, "hsetnx");

    // One collision, then the real store decides.
    hsetnx.mockResolvedValueOnce(false).mockImplementation(real);
    const created = await make();
    expect(created.code).toHaveLength(QUIZ_CODE_LENGTH);
    expect(hsetnx.mock.calls.filter(([, field]) => field === "meta")).toHaveLength(2);
    // The quiz under the drawn code is whole.
    expect((await getQuizView(created.code)).questions).toHaveLength(10);

    // Every draw collides: the host gets a retryable error, not an immortal key.
    hsetnx.mockReset().mockResolvedValue(false);
    const del = vi.spyOn(store, "del");
    await expect(make()).rejects.toMatchObject({ code: "quiz_code_unavailable", status: 500 });
    expect(hsetnx).toHaveBeenCalledTimes(5);
    expect(del).not.toHaveBeenCalled();
    hsetnx.mockRestore();
    del.mockRestore();
  });

  it("draws its own seed when the caller gives none, and every quiz gets its own token", async () => {
    // The route never passes a seed; only the tests do. Two creates from the
    // same playlist must be two quizzes with two codes and two host tokens.
    const a = await make({ seed: undefined });
    const b = await make({ seed: undefined });
    expect(a.code).not.toBe(b.code);
    expect(a.hostToken).not.toBe(b.hostToken);
    expect((await getQuizView(a.code)).questions).toHaveLength(10);
    expect((await getQuizView(b.code)).questions).toHaveLength(10);
  });

  it("deletes a claim whose key already held questions rather than build on stale data", async () => {
    // A fresh key cannot already have `q`. If it does, something is wrong under
    // that code and the claim is released — the same rule as a failed expire.
    const store = await getKvStore();
    const real = store.hsetnx.bind(store);
    const hsetnx = vi
      .spyOn(store, "hsetnx")
      .mockImplementationOnce(real) // meta claim wins
      .mockResolvedValueOnce(false); // questions already there
    const del = vi.spyOn(store, "del");
    await expect(make()).rejects.toMatchObject({ code: "quiz_code_unavailable", status: 500 });
    expect(del).toHaveBeenCalledTimes(1);
    const [key] = del.mock.calls[0];
    expect(key).toMatch(/^quiz:v1:/);
    // The claim is gone: a reader finds nothing under that code.
    expect(await store.hgetall(key)).toEqual({});
    hsetnx.mockRestore();
    del.mockRestore();
  });
});

describe("getQuizView", () => {
  it("returns the questions without the key and an empty, sorted board", async () => {
    const created = await make();
    const view = await getQuizView(created.code);
    expect(view.code).toBe(created.code);
    expect(view.ownerName).toBe("Wayn");
    expect(view.questionCount).toBe(10);
    expect(view.hintAllowance).toBe(1);
    expect(view.questions).toHaveLength(10);
    for (const q of view.questions) {
      expect(q.options).toHaveLength(QUIZ_OPTION_COUNT);
      expect(JSON.stringify(q)).not.toMatch(/answer|track/);
    }
    expect(view.scoreboard).toEqual([]);
  });

  it("is case-insensitive on the code, like a room", async () => {
    const created = await make();
    const view = await getQuizView(created.code.toLowerCase());
    expect(view.code).toBe(created.code);
  });

  it("404s an unknown, malformed or expired code without touching KV for bad shapes", async () => {
    const store = await getKvStore();
    const hgetall = vi.spyOn(store, "hgetall");
    await expect(getQuizView("NOPE")).rejects.toMatchObject({ code: "quiz_not_found", status: 404 });
    await expect(getQuizView("../../..")).rejects.toMatchObject({ code: "quiz_not_found" });
    expect(hgetall).not.toHaveBeenCalled();
    hgetall.mockRestore();

    const created = await make();
    const now = vi.spyOn(Date, "now").mockReturnValue(created.expiresAt + 1);
    await expect(getQuizView(created.code)).rejects.toMatchObject({ code: "quiz_not_found" });
    now.mockRestore();
  });

  it("peekQuiz answers with null rather than throwing, for the unfurl", async () => {
    expect(await peekQuiz("ZZZZZZ")).toBeNull();
    expect(await peekQuiz("../x")).toBeNull();
    const created = await make();
    expect(await peekQuiz(created.code)).toEqual({
      code: created.code,
      ownerName: "Wayn",
      playlistName: "Late nights",
      questionCount: 10,
      locale: "zh",
    });
    // The code it hands back is the stored one, whatever the segment said:
    // the page's self-canonical and the card image's URL are built from it.
    expect((await peekQuiz(created.code.toLowerCase()))?.code).toBe(created.code);
  });

  it("peekQuiz swallows a KV failure, since generateMetadata runs on every unfurl", async () => {
    // A chat app fetching the link during a KV hiccup must get the static
    // title, not a 500 — the same fail-soft rule the rate limiter follows.
    const created = await make();
    const store = await getKvStore();
    const hgetall = vi.spyOn(store, "hgetall").mockRejectedValueOnce(new Error("kv down"));
    expect(await peekQuiz(created.code)).toBeNull();
    hgetall.mockRestore();
    // And the view, which is not fail-soft, surfaces the same failure as a throw.
    const again = vi.spyOn(store, "hgetall").mockRejectedValueOnce(new Error("kv down"));
    await expect(getQuizView(created.code)).rejects.toThrow("kv down");
    again.mockRestore();
  });

  it("normalizeQuizCode accepts exactly the six-character alphabet, case-insensitively", () => {
    expect(normalizeQuizCode(" abc234 ")).toBe("ABC234");
    expect(normalizeQuizCode("ABC234")).toBe("ABC234");
    // Wrong length, confusable characters, non-strings: all shape failures
    // that must cost nothing before KV is asked.
    for (const bad of ["ABC23", "ABC2345", "ABC01O", "ABCDIL", "AB C23", "", null, undefined, 123456, ["ABC234"]]) {
      expect(normalizeQuizCode(bad), String(bad)).toBeNull();
    }
  });

  it("reads a damaged hash tolerantly: no questions is a 404, bad rows are skipped, bad locale is en", async () => {
    const created = await make();
    const store = await getKvStore();
    const key = `quiz:v1:${created.code}`;

    // Rows that are not scores are dropped rather than crashing the read.
    await store.hsetnx(key, "s:noname", { correct: 3 });
    await store.hsetnx(key, "s:nocorrect", { name: "X", correct: "3" });
    await store.hsetnx(key, "s:null", null);
    await store.hsetnx(key, "s:ok", { name: "Ok", correct: 1, total: 5, hintsUsed: 0, at: 1 });
    expect((await getQuizView(created.code)).scoreboard.map((s) => s.name)).toEqual(["Ok"]);

    // A locale that is not one we ship falls back to English for the unfurl.
    const raw = await store.hgetall<{ locale: string }>(key);
    await store.hdel(key, "meta");
    await store.hsetnx(key, "meta", { ...raw.meta, locale: "fr" });
    expect((await peekQuiz(created.code))?.locale).toBe("en");

    // A claim that never got its questions (a create that died mid-way and
    // whose cleanup also failed) reads as not found, not as an empty quiz.
    await store.hdel(key, "q");
    await store.hsetnx(key, "q", []);
    await expect(getQuizView(created.code)).rejects.toMatchObject({ code: "quiz_not_found", status: 404 });
    await store.hdel(key, "q");
    await expect(getQuizView(created.code)).rejects.toMatchObject({ code: "quiz_not_found", status: 404 });
    // And a meta with no usable expiry is treated the same way.
    await store.hdel(key, "meta");
    await store.hsetnx(key, "meta", { ...raw.meta, expiresAt: "never" });
    await expect(getQuizView(created.code)).rejects.toMatchObject({ code: "quiz_not_found" });
  });
});

describe("submitQuizAnswers", () => {
  it("grades against the stored key, not anything the client claims", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const perfect = await submitQuizAnswers(created.code, "Alice", key, 0);
    expect(perfect).toMatchObject({ correct: 10, total: 10, verdict: "soulmate", recorded: true, rank: 1, hintsUsed: 0 });
    expect(perfect.key).toEqual(key);

    const wrong = key.map((a) => (a + 1) % QUIZ_OPTION_COUNT);
    const zero = await submitQuizAnswers(created.code, "Bob", wrong, 1);
    expect(zero).toMatchObject({ correct: 0, verdict: "stranger", rank: 2 });
    expect(zero.scoreboard.map((s) => s.name)).toEqual(["Alice", "Bob"]);
  });

  it("refuses a name that is already on the board, case-insensitively", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    await submitQuizAnswers(created.code, "Alice", key, 0);
    await expect(submitQuizAnswers(created.code, " alice ", key, 0)).rejects.toMatchObject({
      code: "quiz_name_taken",
      status: 409,
    });
  });

  it("decides a simultaneous claim with hsetnx, not with the pre-check", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    // Both submissions read an empty board, then race to the claim.
    const store = await getKvStore();
    const hsetnx = vi.spyOn(store, "hsetnx");
    const results = await Promise.allSettled([
      submitQuizAnswers(created.code, "Alice", key, 0),
      submitQuizAnswers(created.code, "alice", key, 0),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // Both submissions passed the advisory pre-check (they read an empty
    // board) and reached the claim; the hash, not the pre-check, decided.
    const claims = hsetnx.mock.calls.filter((c) => c[1] === "s:alice");
    expect(claims).toHaveLength(2);
    hsetnx.mockRestore();
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: "quiz_name_taken" });
    expect((await getQuizView(created.code)).scoreboard).toHaveLength(1);
  });

  it("rejects an empty name and an answer list of the wrong shape", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    await expect(submitQuizAnswers(created.code, "  ", key, 0)).rejects.toMatchObject({ code: "quiz_name_required" });
    await expect(submitQuizAnswers(created.code, "A", key.slice(1), 0)).rejects.toMatchObject({ code: "quiz_invalid_answers" });
    await expect(submitQuizAnswers(created.code, "A", [9, 9, 9, 9, 9], 0)).rejects.toMatchObject({ code: "quiz_invalid_answers" });
    await expect(submitQuizAnswers(created.code, "A", "01230", 0)).rejects.toMatchObject({ code: "quiz_invalid_answers" });
  });

  it("clamps the client's hint count and uses it as the tiebreak", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const a = await submitQuizAnswers(created.code, "A", key, 99);
    expect(a.hintsUsed).toBe(1); // hintAllowance(5)
    const b = await submitQuizAnswers(created.code, "B", key, 0);
    expect(b.rank).toBe(1);
    expect(b.scoreboard.map((s) => s.name)).toEqual(["B", "A"]);
  });

  it("still grades past the cap, but does not record", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const store = await getKvStore();
    for (let i = 0; i < QUIZ_MAX_ENTRIES; i += 1) {
      await store.hsetnx(`quiz:v1:${created.code}`, `s:p${i}`, {
        name: `p${i}`, correct: 6, total: 10, hintsUsed: 0, at: i,
      });
    }
    const late = await submitQuizAnswers(created.code, "Late", key, 0);
    expect(late).toMatchObject({ correct: 10, recorded: false, rank: null });
    expect(late.scoreboard).toHaveLength(QUIZ_MAX_ENTRIES);
    expect(late.scoreboard.some((s) => s.name === "Late")).toBe(false);
  });

  it("takes CJK, emoji and full-length names, keeps them verbatim, and ranks them", async () => {
    // The fold is `trim().toLowerCase()`, which is a no-op on CJK and emoji;
    // the hash field is `s:` + that, so these have to round-trip through KV
    // and back onto the board exactly as typed. The length cap is the route's
    // (zod, QUIZ_NAME_MAX); the store takes what it is handed.
    const created = await make();
    const key = await keyFor(created.code);
    const names = ["小明", "🎉 party", "a".repeat(QUIZ_NAME_MAX), "  Wayne  "];
    for (const [i, n] of names.entries()) {
      const r = await submitQuizAnswers(created.code, n, key.map((a, j) => (j <= i ? a : (a + 1) % QUIZ_OPTION_COUNT)), 0);
      expect(r.recorded).toBe(true);
    }
    const view = await getQuizView(created.code);
    expect(view.scoreboard.map((s) => s.name)).toEqual(["Wayne", "a".repeat(QUIZ_NAME_MAX), "🎉 party", "小明"]);
    // Duplicates are refused for these spellings too.
    await expect(submitQuizAnswers(created.code, "小明 ", key, 0)).rejects.toMatchObject({ code: "quiz_name_taken" });
    await expect(submitQuizAnswers(created.code, "🎉 PARTY", key, 0)).rejects.toMatchObject({ code: "quiz_name_taken" });
  });

  it("refuses answers and hints for a quiz that has passed its expiry, whatever KV still holds", async () => {
    // `requireQuiz` is the single gate. The record's own `expiresAt`, not the
    // key's eviction, decides — so a submission that lands after the printed
    // expiry is refused even if Redis has not swept the hash yet.
    const created = await make();
    const key = await keyFor(created.code);
    const now = vi.spyOn(Date, "now").mockReturnValue(created.expiresAt);
    await expect(submitQuizAnswers(created.code, "Late", key, 0)).rejects.toMatchObject({ code: "quiz_not_found", status: 404 });
    await expect(getQuizHint(created.code, 0)).rejects.toMatchObject({ code: "quiz_not_found" });
    await expect(getQuizBoard(created.code, created.hostToken)).rejects.toMatchObject({ code: "quiz_not_found" });
    now.mockRestore();
    expect(previewCache.getPreview).not.toHaveBeenCalled();
  });

  it("never extends the quiz's expiry on a submission", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const store = await getKvStore();
    const expire = vi.spyOn(store, "expire");
    await submitQuizAnswers(created.code, "A", key, 0);
    expect(expire).not.toHaveBeenCalled();
    expire.mockRestore();
    expect((await getQuizView(created.code)).expiresAt).toBe(created.expiresAt);
  });

  it("reads a legacy score row missing newer fields without throwing", async () => {
    const created = await make();
    const store = await getKvStore();
    await store.hsetnx(`quiz:v1:${created.code}`, "s:old", { name: "Old", correct: 2 });
    const view = await getQuizView(created.code);
    expect(view.scoreboard).toEqual([{ name: "Old", correct: 2, total: 10, hintsUsed: 0, at: 0 }]);
  });
});

describe("checkQuizAnswer", () => {
  it("hands over one question's answer against a pick for it, and says whether the pick was right", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    for (let q = 0; q < key.length; q += 1) {
      const right = await checkQuizAnswer(created.code, q, key[q]);
      expect(right).toEqual({ answer: key[q], correct: true });
      const wrong = await checkQuizAnswer(created.code, q, (key[q] + 1) % QUIZ_OPTION_COUNT);
      expect(wrong).toEqual({ answer: key[q], correct: false });
    }
  });

  it("records nothing: the board is still written once, by the sheet", async () => {
    // A verdict is not a submission. Twenty checks under no name leave the
    // board empty, and the sheet that follows is graded as it always was.
    const created = await make();
    const key = await keyFor(created.code);
    for (let q = 0; q < key.length; q += 1) await checkQuizAnswer(created.code, q, 0);
    expect((await getQuizView(created.code)).scoreboard).toEqual([]);
    const graded = await submitQuizAnswers(created.code, "Alice", key, 0);
    expect(graded).toMatchObject({ correct: 10, recorded: true, rank: 1 });
  });

  it("refuses a question or a pick out of range before reading the hash, and a dead quiz after", async () => {
    const created = await make();
    const store = await getKvStore();
    const hgetall = vi.spyOn(store, "hgetall");
    for (const [q, pick] of [
      [-1, 0],
      [1.5, 0],
      [QUIZ_MAX_QUESTIONS, 0],
      [0, -1],
      [0, 0.5],
    ] as const) {
      await expect(checkQuizAnswer(created.code, q, pick)).rejects.toMatchObject({ code: "quiz_invalid_answers", status: 422 });
    }
    expect(hgetall).not.toHaveBeenCalled();
    hgetall.mockRestore();
    // In range for the schema, past the end of this quiz's ten, or past its two options.
    await expect(checkQuizAnswer(created.code, 10, 0)).rejects.toMatchObject({ code: "quiz_invalid_answers" });
    await expect(checkQuizAnswer(created.code, 0, QUIZ_OPTION_COUNT)).rejects.toMatchObject({ code: "quiz_invalid_answers" });
    await expect(checkQuizAnswer("ZZZZZZ", 0, 0)).rejects.toMatchObject({ code: "quiz_not_found", status: 404 });
    // Case-insensitive on the code, like every other read.
    expect(await checkQuizAnswer(created.code.toLowerCase(), 0, 0)).toMatchObject({ answer: expect.any(Number) });
  });
});

describe("the code is canonical on every write", () => {
  it("writes a padded or lower-case code's row into the real quiz, never a phantom key", async () => {
    // `/api/quiz/%20abcdef/answer` used to read the real quiz and then hsetnx a
    // row into `quiz:v1: ABCDEF` — a fresh hash no `expire` ever touches.
    const created = await make();
    const key = await keyFor(created.code);
    const store = await getKvStore();
    const hsetnx = vi.spyOn(store, "hsetnx");
    const result = await submitQuizAnswers(` ${created.code.toLowerCase()} `, "Pad", key, 0);
    expect(result.recorded).toBe(true);
    expect(hsetnx).toHaveBeenCalledTimes(1);
    expect(hsetnx.mock.calls[0][0]).toBe(`quiz:v1:${created.code}`);
    hsetnx.mockRestore();
    expect((await getQuizView(created.code)).scoreboard.map((s) => s.name)).toEqual(["Pad"]);
    expect(await store.hgetall(`quiz:v1: ${created.code}`)).toEqual({});
    expect(await store.hgetall(`quiz:v1: ${created.code.toLowerCase()} `)).toEqual({});
  });
});

describe("a resend after a lost response", () => {
  it("replays the taker's own row instead of refusing their name", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const first = await submitQuizAnswers(created.code, "Alice", key, 1, "attempt-1");
    // The reply was lost; the page resends the identical attempt.
    const again = await submitQuizAnswers(created.code, "alice", key, 1, "attempt-1");
    expect(again).toMatchObject({ correct: 10, recorded: true, rank: 1, hintsUsed: 1 });
    expect(again.scoreboard).toEqual(first.scoreboard);
    expect((await getQuizView(created.code)).scoreboard).toHaveLength(1);
    // A different attempt under the same name is still someone else.
    await expect(submitQuizAnswers(created.code, "Alice", key, 0, "attempt-2")).rejects.toMatchObject({
      code: "quiz_name_taken",
    });
    await expect(submitQuizAnswers(created.code, "Alice", key, 0)).rejects.toMatchObject({ code: "quiz_name_taken" });
  });

  it("recognises its own row even when the first write won a race it never heard about", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const store = await getKvStore();
    // Simulate: the pre-check saw an empty board, the claim landed, the reply
    // was lost — by writing the row behind the pre-check's back.
    const original = store.hsetnx.bind(store);
    const spy = vi.spyOn(store, "hsetnx").mockImplementationOnce(async (k, f, v) => {
      await original(k, f, { ...(v as object), sid: "attempt-9" });
      return false; // what a lost race looks like to the caller
    });
    const result = await submitQuizAnswers(created.code, "Bob", key, 0, "attempt-9");
    spy.mockRestore();
    expect(result).toMatchObject({ correct: 10, recorded: true, rank: 1 });
  });

  it("never sends the attempt id back out, on either view", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    await submitQuizAnswers(created.code, "A", key, 0, "secret-attempt");
    expect(JSON.stringify(await getQuizView(created.code))).not.toContain("secret-attempt");
    expect(JSON.stringify(await getQuizBoard(created.code, created.hostToken))).not.toContain("secret-attempt");
  });
});

describe("what the taker's phone receives", () => {
  it("never carries another taker's per-question results", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const mine = await submitQuizAnswers(created.code, "A", key, 0);
    expect(mine.scoreboard.every((s) => !("right" in s))).toBe(true);
    const view = await getQuizView(created.code);
    expect(view.scoreboard).toEqual([{ name: "A", correct: 10, total: 10, hintsUsed: 0, at: expect.any(Number) }]);
    // The owner's board still has it.
    const board = await getQuizBoard(created.code, created.hostToken);
    expect(board.scoreboard[0].right).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("getQuizBoard", () => {
  it("is refused without the host token, and answers with it", async () => {
    const created = await make();
    await expect(getQuizBoard(created.code, "")).rejects.toMatchObject({ code: "quiz_not_host", status: 403 });
    await expect(getQuizBoard(created.code, "nope")).rejects.toMatchObject({ code: "quiz_not_host" });
    const board = await getQuizBoard(created.code, created.hostToken);
    expect(board).toMatchObject({ code: created.code, ownerName: "Wayn", takers: 0, averageCorrect: null });
    expect(board.questions).toHaveLength(10);
    expect(board.questions.every((q) => q.answered === 0 && q.correct === 0)).toBe(true);
  });

  it("names each question's real song and how many got it", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    await submitQuizAnswers(created.code, "A", key, 0);
    await submitQuizAnswers(created.code, "B", key.map((a, i) => (i === 0 ? (a + 1) % QUIZ_OPTION_COUNT : a)), 0);
    const board = await getQuizBoard(created.code, created.hostToken);
    expect(board.takers).toBe(2);
    expect(board.averageCorrect).toBeCloseTo(9.5);
    expect(board.questions[0]).toMatchObject({ answered: 2, correct: 1 });
    expect(board.questions[1]).toMatchObject({ answered: 2, correct: 2 });
    const store = await getKvStore();
    const raw = await store.hgetall<unknown>(`quiz:v1:${created.code}`);
    const q0 = (raw.q as Array<{ options: Array<{ title: string }>; answer: number }>)[0];
    expect(board.questions[0].title).toBe(q0.options[q0.answer].title);
    expect(board.scoreboard.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("counts a row written before `right` existed toward takers and the mean, not the per-question rates", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    const store = await getKvStore();
    await store.hsetnx(`quiz:v1:${created.code}`, "s:legacy", { name: "Legacy", correct: 1, total: 10, hintsUsed: 0, at: 1 });
    await submitQuizAnswers(created.code, "New", key, 0);
    const board = await getQuizBoard(created.code, created.hostToken);
    expect(board.takers).toBe(2);
    expect(board.averageCorrect).toBeCloseTo(5.5);
    for (const q of board.questions) expect(q).toMatchObject({ answered: 1, correct: 1 });
    expect(board.scoreboard.map((s) => s.name)).toEqual(["New", "Legacy"]);
  });

  it("does not store which option a taker picked, only which questions were right", async () => {
    const created = await make();
    const key = await keyFor(created.code);
    await submitQuizAnswers(created.code, "A", key.map((a, i) => (i < 2 ? a : (a + 1) % QUIZ_OPTION_COUNT)), 0);
    const store = await getKvStore();
    const raw = await store.hgetall<unknown>(`quiz:v1:${created.code}`);
    expect(raw["s:a"]).toMatchObject({ right: [0, 1] });
    expect(JSON.stringify(raw["s:a"])).not.toContain("answers");
  });
});

describe("getQuizHint", () => {
  it("resolves the clip for the real track of that question, through the preview cache", async () => {
    vi.mocked(previewCache.getPreview).mockResolvedValue({ previewUrl: "https://cdn/x.m4a", status: "found" });
    const created = await make();
    const store = await getKvStore();
    const raw = await store.hgetall<unknown>(`quiz:v1:${created.code}`);
    const q = (raw.q as Array<{ track: { id: string; name: string; artist: string; durationMs: number } }>)[2];

    const result = await getQuizHint(created.code, 2);
    expect(result).toEqual({ previewUrl: "https://cdn/x.m4a", status: "found" });
    expect(previewCache.getPreview).toHaveBeenCalledWith(
      {
        id: q.track.id,
        track: q.track.name,
        artist: q.track.artist,
        durationMs: q.track.durationMs,
      },
      { refresh: false }
    );
  });

  it("omits a zero running time and clamps an over-long title, so the lookup lands on the game's own cache key", async () => {
    // `durationMs: 0` is what buildQuiz stores for a track parseGamePayload
    // repaired; passing 0 to the picker would make the duration tier veto every
    // candidate. And the title goes through the same clamp as both preview
    // routes — a different key here would be two answers for one track.
    vi.mocked(previewCache.getPreview).mockResolvedValue({ previewUrl: null, status: "absent" });
    const long = "x".repeat(PREVIEW_FIELD_MAX + 50);
    const created = await make({
      tracks: [
        { ...track("1", long, "The Weeknd"), durationMs: 0 },
        ...PLAYLIST.slice(1),
      ],
      questionCount: PLAYLIST.length,
    });
    const store = await getKvStore();
    const raw = await store.hgetall<unknown>(`quiz:v1:${created.code}`);
    const questions = raw.q as Array<{ track: { id: string; name: string; durationMs: number } }>;
    const i = questions.findIndex((q) => q.track.id === "1");
    expect(questions[i].track.name).toBe(long); // stored in full
    await getQuizHint(created.code, i);
    const arg = vi.mocked(previewCache.getPreview).mock.calls[0][0];
    expect(arg.id).toBe("1");
    expect(arg.durationMs).toBeUndefined();
    expect([...arg.track].length).toBe(PREVIEW_FIELD_MAX);
  });

  it("passes absent and unavailable through untouched, and lets a preview failure propagate", async () => {
    // The page does not need to know which null it got — only that the hint is
    // not charged — but the wire shape must be the preview routes' own so the
    // client reads it with one rule. A throw is not a QuizError: it is the
    // route's `server_error`, not a 404 on a quiz that exists.
    const created = await make();
    for (const result of [
      { previewUrl: null, status: "absent" as const },
      { previewUrl: null, status: "unavailable" as const },
    ]) {
      vi.mocked(previewCache.getPreview).mockResolvedValueOnce(result);
      expect(await getQuizHint(created.code, 0)).toEqual(result);
    }
    vi.mocked(previewCache.getPreview).mockRejectedValueOnce(new Error("itunes down"));
    const failure = await getQuizHint(created.code, 0).then(
      () => null,
      (e: unknown) => e
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(QuizError);
    expect((failure as Error).message).toBe("itunes down");
  });

  it("passes refresh through to the preview cache, and defaults it off", async () => {
    vi.mocked(previewCache.getPreview).mockResolvedValue({ previewUrl: "https://cdn/y.m4a", status: "found" });
    const created = await make();
    await getQuizHint(created.code, 0);
    expect(vi.mocked(previewCache.getPreview).mock.calls[0][1]).toEqual({ refresh: false });
    await getQuizHint(created.code, 0, { refresh: true });
    expect(vi.mocked(previewCache.getPreview).mock.calls[1][1]).toEqual({ refresh: true });
  });

  it("rejects a malformed index before reading the hash", async () => {
    const created = await make();
    const store = await getKvStore();
    const hgetall = vi.spyOn(store, "hgetall");
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, QUIZ_MAX_QUESTIONS, 999]) {
      await expect(getQuizHint(created.code, bad)).rejects.toMatchObject({ code: "preview_request_invalid" });
    }
    expect(hgetall).not.toHaveBeenCalled();
    hgetall.mockRestore();
  });

  it("refuses an index outside the quiz, and an unknown code", async () => {
    const created = await make();
    await expect(getQuizHint(created.code, 10)).rejects.toMatchObject({ code: "preview_request_invalid", status: 422 });
    await expect(getQuizHint(created.code, -1)).rejects.toMatchObject({ code: "preview_request_invalid" });
    await expect(getQuizHint(created.code, 1.5)).rejects.toMatchObject({ code: "preview_request_invalid" });
    await expect(getQuizHint("ZZZZZZ", 0)).rejects.toBeInstanceOf(QuizError);
    expect(previewCache.getPreview).not.toHaveBeenCalled();
  });
});
