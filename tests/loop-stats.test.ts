import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_LOCALES } from "@/lib/error-messages";
import { LOOP_SURFACES } from "@/lib/loop-links";
import { QUIZ_VERDICTS } from "@/lib/quiz";
import { QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "@/types/quiz";

const kv = vi.hoisted(() => ({
  incrs: [] as Array<{ key: string; ttl: number; by?: number }>,
  failWrites: false,
}));

vi.mock("@/lib/kv", () => ({
  dayBucket: () => "2026-08-09",
  getKvStore: async () => ({
    async incr(key: string, ttl: number, by?: number) {
      if (kv.failWrites) throw new Error("kv unavailable");
      kv.incrs.push({ key, ttl, by });
      return 1;
    },
  }),
}));

const {
  GAME_ENDS,
  GAME_ROUND_CEILING,
  HOST_INDEX_CEILING,
  LOOP_STATS_TTL_SECONDS,
  MIXED_SUB_MODES,
  PLAYLIST_REFUSAL_CODES,
  QUIZ_STAGES,
  QUIZ_LENGTH_STAGES,
  QUIZ_HINT_OUTCOMES,
  QUIZ_SHARE_BYS,
  QUIZ_SHARE_OUTCOMES,
  QUIZ_THROTTLED_ROUTES,
  loopStatsKeys,
  recordGameEnd,
  recordGameStart,
  recordPlaylistRefused,
  recordQuizShare,
  recordQuizStage,
  recordQuizVerdict,
  recordQuizLength,
  recordQuizCreated,
  recordQuizCompleted,
  recordQuizHint,
  recordQuizThrottled,
  recordLoopClick,
  recordLoopImpression,
  recordLoopThrottled,
  __resetLivenessForTests,
} = await import("@/lib/loop-stats");

beforeEach(() => {
  kv.incrs = [];
  kv.failWrites = false;
  // The liveness memo is per-process, so without this every case after the
  // first would run against an instance that has already reported today.
  __resetLivenessForTests();
});

const keysWritten = () => kv.incrs.map((i) => i.key);

describe("the key format is the contract between writer and reader", () => {
  it("writes exactly the keys loopStatsKeys says it will read", async () => {
    // If these two ever disagree the digest reads a key nobody writes,
    // reports zero, and never errors. This is the test that catches it.
    const expected = loopStatsKeys("2026-08-09", LOOP_SURFACES);

    await recordLoopImpression("buzz_cta");
    expect(keysWritten()).toContain(expected.impressions.buzz_cta);

    kv.incrs = [];
    await recordLoopClick("buzz_cta");
    expect(keysWritten()).toContain(expected.clicks.buzz_cta);

    kv.incrs = [];
    await recordLoopThrottled();
    expect(keysWritten()).toContain(expected.throttled);

    kv.incrs = [];
    await recordGameStart(3);
    expect(keysWritten()).toContain(expected.games);
    expect(keysWritten()).toContain(expected.hostIndex[2]); // host_index:3

    for (const mixed of ["room", "phone"] as const) {
      kv.incrs = [];
      await recordGameStart(1, mixed);
      expect(keysWritten()).toContain(expected.mixedPool[mixed]);
    }

    for (const stage of QUIZ_STAGES) {
      kv.incrs = [];
      await recordQuizStage(stage);
      expect(keysWritten()).toContain(expected.quiz[stage]);
    }

    for (const verdict of QUIZ_VERDICTS) {
      kv.incrs = [];
      await recordQuizVerdict(verdict);
      expect(keysWritten()).toContain(expected.quizVerdict[verdict]);
    }

    for (const stage of QUIZ_LENGTH_STAGES) {
      for (const n of [QUIZ_MIN_QUESTIONS, 23, QUIZ_MAX_QUESTIONS]) {
        kv.incrs = [];
        await recordQuizLength(stage, n);
        expect(keysWritten()).toContain(expected.quizLength[stage][n]);
      }
    }

    for (const locale of ERROR_LOCALES) {
      kv.incrs = [];
      await recordQuizCreated({ questionCount: 20, requestedCount: 20, locale });
      expect(keysWritten()).toContain(expected.quizLocale[locale]);
    }

    kv.incrs = [];
    await recordQuizCreated({ questionCount: 30, requestedCount: 50, locale: "en" });
    expect(keysWritten()).toContain(expected.quizClamped);

    for (const outcome of QUIZ_HINT_OUTCOMES) {
      kv.incrs = [];
      if (outcome === "refresh") await recordQuizHint("found", true);
      else await recordQuizHint(outcome, false);
      expect(keysWritten()).toContain(expected.quizHint[outcome]);
    }

    for (const route of QUIZ_THROTTLED_ROUTES) {
      kv.incrs = [];
      await recordQuizThrottled(route);
      expect(keysWritten()).toContain(expected.quizThrottled[route]);
    }

    for (const by of QUIZ_SHARE_BYS) {
      for (const outcome of QUIZ_SHARE_OUTCOMES) {
        kv.incrs = [];
        await recordQuizShare(by, outcome);
        expect(keysWritten()).toContain(expected.quizShare[by][outcome]);
      }
    }

    for (const end of GAME_ENDS) {
      kv.incrs = [];
      await recordGameEnd(end, 5);
      expect(keysWritten()).toContain(expected.gameEnd[end]);
    }
    kv.incrs = [];
    await recordGameEnd("ended_early", 5);
    expect(keysWritten()).toContain(expected.gameEndRound[4]); // game_end_round:5

    for (const code of PLAYLIST_REFUSAL_CODES) {
      kv.incrs = [];
      await recordPlaylistRefused(code);
      expect(keysWritten()).toContain(expected.playlistRefused[code]);
    }
  });

  it("refuses to key a verdict that is not one of the declared buckets", async () => {
    // The value becomes the tail of a key, so an unguarded string from a
    // request body would be an unbounded key space.
    await recordQuizVerdict("83.7%" as never);
    expect(keysWritten()).toEqual([]);
  });

  it("covers every surface on both sides", () => {
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    for (const surface of LOOP_SURFACES) {
      expect(keys.impressions[surface]).toBe(
        `loop:stats:2026-08-09:impression:${surface}`
      );
      expect(keys.clicks[surface]).toBe(`loop:stats:2026-08-09:click:${surface}`);
    }
    expect(keys.hostIndex).toHaveLength(HOST_INDEX_CEILING);
  });

  it("names a key for every declared mixed sub-mode", () => {
    // The union and the key map are two places one list has to be right, and
    // adding a member to the union while forgetting the map fails nothing at
    // runtime — the counter just never appears.
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    for (const mode of MIXED_SUB_MODES) {
      expect(keys.mixedPool[mode]).toBe(`loop:stats:2026-08-09:mixed_pool:${mode}`);
    }
    expect(Object.keys(keys.mixedPool)).toHaveLength(MIXED_SUB_MODES.length);
  });

  it("names a key for every quiz stage and every verdict bucket", () => {
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    for (const stage of QUIZ_STAGES) {
      expect(keys.quiz[stage]).toBe(`loop:stats:2026-08-09:quiz:${stage}`);
    }
    expect(Object.keys(keys.quiz)).toHaveLength(QUIZ_STAGES.length);
    for (const verdict of QUIZ_VERDICTS) {
      expect(keys.quizVerdict[verdict]).toBe(`loop:stats:2026-08-09:quiz_verdict:${verdict}`);
    }
    expect(Object.keys(keys.quizVerdict)).toHaveLength(QUIZ_VERDICTS.length);
  });

  it("names a key for every quiz length, locale, hint outcome and throttled route", () => {
    // Each of these becomes a key tail from a closed set; the map and the set
    // are two places one list has to agree, and a member added to one without
    // the other fails nothing at runtime — the counter just never appears.
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    for (const stage of QUIZ_LENGTH_STAGES) {
      const span = QUIZ_MAX_QUESTIONS - QUIZ_MIN_QUESTIONS + 1;
      expect(Object.keys(keys.quizLength[stage])).toHaveLength(span);
      expect(keys.quizLength[stage][QUIZ_MIN_QUESTIONS]).toBe(
        `loop:stats:2026-08-09:quiz_len:${stage}:${QUIZ_MIN_QUESTIONS}`
      );
      expect(keys.quizLength[stage][QUIZ_MAX_QUESTIONS]).toBe(
        `loop:stats:2026-08-09:quiz_len:${stage}:${QUIZ_MAX_QUESTIONS}`
      );
    }
    expect(keys.quizClamped).toBe("loop:stats:2026-08-09:quiz_clamped");
    for (const locale of ERROR_LOCALES) {
      expect(keys.quizLocale[locale]).toBe(`loop:stats:2026-08-09:quiz_locale:${locale}`);
    }
    expect(Object.keys(keys.quizLocale)).toHaveLength(ERROR_LOCALES.length);
    for (const outcome of QUIZ_HINT_OUTCOMES) {
      expect(keys.quizHint[outcome]).toBe(`loop:stats:2026-08-09:quiz_hint:${outcome}`);
    }
    expect(Object.keys(keys.quizHint)).toHaveLength(QUIZ_HINT_OUTCOMES.length);
    for (const route of QUIZ_THROTTLED_ROUTES) {
      expect(keys.quizThrottled[route]).toBe(`loop:stats:2026-08-09:quiz_throttled:${route}`);
    }
    expect(Object.keys(keys.quizThrottled)).toHaveLength(QUIZ_THROTTLED_ROUTES.length);
  });

  it("names a key for every share pair, every game end, every early round and every refusal code", () => {
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    for (const by of QUIZ_SHARE_BYS) {
      expect(Object.keys(keys.quizShare[by])).toHaveLength(QUIZ_SHARE_OUTCOMES.length);
      for (const outcome of QUIZ_SHARE_OUTCOMES) {
        expect(keys.quizShare[by][outcome]).toBe(`loop:stats:2026-08-09:quiz_share:${by}:${outcome}`);
      }
    }
    expect(Object.keys(keys.quizShare)).toHaveLength(QUIZ_SHARE_BYS.length);
    for (const end of GAME_ENDS) {
      expect(keys.gameEnd[end]).toBe(`loop:stats:2026-08-09:game_end:${end}`);
    }
    expect(Object.keys(keys.gameEnd)).toHaveLength(GAME_ENDS.length);
    expect(keys.gameEndRound).toHaveLength(GAME_ROUND_CEILING);
    expect(keys.gameEndRound[0]).toBe("loop:stats:2026-08-09:game_end_round:1");
    for (const code of PLAYLIST_REFUSAL_CODES) {
      expect(keys.playlistRefused[code]).toBe(`loop:stats:2026-08-09:playlist_refused:${code}`);
    }
    expect(Object.keys(keys.playlistRefused)).toHaveLength(PLAYLIST_REFUSAL_CODES.length);
  });
});

describe("game ends", () => {
  const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);

  it("keys the round only for an early end — a played-out game's round is its song count", async () => {
    await recordGameEnd("played_out", 20);
    expect(keysWritten()).toContain(keys.gameEnd.played_out);
    expect(keysWritten().some((k) => k.includes("game_end_round:"))).toBe(false);

    kv.incrs = [];
    await recordGameEnd("ended_early", 3);
    expect(keysWritten()).toContain(keys.gameEnd.ended_early);
    expect(keysWritten()).toContain(keys.gameEndRound[2]);
  });

  it("caps the round key space, so a scripted counter cannot fill KV", async () => {
    await recordGameEnd("ended_early", 9_999);
    expect(keysWritten()).toContain(`loop:stats:2026-08-09:game_end_round:${GAME_ROUND_CEILING}`);
  });

  it("clamps nonsense to round one and refuses an end it does not know", async () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      kv.incrs = [];
      await recordGameEnd("ended_early", bad);
      expect(keysWritten()).toContain("loop:stats:2026-08-09:game_end_round:1");
    }
    kv.incrs = [];
    await recordGameEnd("abandoned" as never, 3);
    expect(kv.incrs).toEqual([]);
  });
});

describe("playlist refusals and quiz shares", () => {
  it("refuses a code outside the closed set — a throttling code is not a dead link", async () => {
    for (const code of ["spotify_rate_limited", "spotify_quota_exhausted", "playlist_load_failed", "", "__proto__"]) {
      kv.incrs = [];
      await recordPlaylistRefused(code as never);
      expect(kv.incrs).toEqual([]);
    }
  });

  it("refuses a share whose by or outcome is undeclared — both are key tails", async () => {
    await recordQuizShare("host" as never, "shared");
    await recordQuizShare("owner", "downloaded" as never);
    expect(kv.incrs).toEqual([]);
  });
});

describe("the quiz's length, hint and refusal counters", () => {
  const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);

  it("refuses a length outside the schema's bounds rather than clamping it", async () => {
    // The count is the tail of the key. A clamp would file the quiz under a
    // length nobody chose; refusing keeps the key space exactly the schema's.
    for (const bad of [QUIZ_MIN_QUESTIONS - 1, QUIZ_MAX_QUESTIONS + 1, 0, -1, 20.5, Number.NaN]) {
      kv.incrs = [];
      await recordQuizLength("created", bad);
      expect(kv.incrs).toEqual([]);
    }
  });

  it("records a creation as its stage, its length and its locale", async () => {
    await recordQuizCreated({ questionCount: 20, requestedCount: 20, locale: "zh" });
    const written = keysWritten();
    expect(written).toContain(keys.quiz.created);
    expect(written).toContain(keys.quizLength.created[20]);
    expect(written).toContain(keys.quizLocale.zh);
    expect(written).not.toContain(keys.quizClamped);
  });

  it("counts a quiz built shorter than asked for, and only then", async () => {
    // `buildQuiz` shortens silently and the panel shows the count it got;
    // this is the only record that the host wanted more.
    await recordQuizCreated({ questionCount: 30, requestedCount: 50, locale: "en" });
    expect(keysWritten()).toContain(keys.quizClamped);
    expect(keysWritten()).toContain(keys.quizLength.created[30]);

    kv.incrs = [];
    await recordQuizCreated({ questionCount: 50, requestedCount: 50, locale: "en" });
    expect(keysWritten()).not.toContain(keys.quizClamped);
  });

  it("refuses a locale that is not one of the declared ones", async () => {
    await recordQuizCreated({ questionCount: 20, requestedCount: 20, locale: "fr" as never });
    expect(keysWritten()).toContain(keys.quiz.created);
    expect(keysWritten().some((k) => k.includes("quiz_locale:"))).toBe(false);
  });

  it("records a completion as its stage, its verdict and its length, in one round trip", async () => {
    await recordQuizCompleted({ questionCount: 10, verdict: "close" });
    const written = keysWritten();
    expect(written).toContain(keys.quiz.completed);
    expect(written).toContain(keys.quizVerdict.close);
    expect(written).toContain(keys.quizLength.completed[10]);
    // Three metrics plus the marker once — not once per metric, which is what
    // a `Promise.all` over the old memo did on the first event of the day.
    expect(kv.incrs).toHaveLength(4);
    expect(kv.incrs.filter((i) => i.key === keys.live)).toHaveLength(1);
  });

  it("keys a hint by its preview status, and a repair as well as its status", async () => {
    await recordQuizHint("found", false);
    expect(keysWritten()).toEqual(expect.arrayContaining([keys.quizHint.found]));
    expect(keysWritten()).not.toContain(keys.quizHint.refresh);

    kv.incrs = [];
    await recordQuizHint("found", true);
    expect(keysWritten()).toContain(keys.quizHint.found);
    expect(keysWritten()).toContain(keys.quizHint.refresh);

    kv.incrs = [];
    await recordQuizHint("unavailable", false);
    expect(keysWritten()).toContain(keys.quizHint.unavailable);
  });

  it("refuses a hint status that is not a preview status", async () => {
    await recordQuizHint("throttled" as never, false);
    expect(kv.incrs).toEqual([]);
  });

  it("refuses a throttled route it does not know", async () => {
    await recordQuizThrottled("pool" as never);
    expect(kv.incrs).toEqual([]);
  });
});

describe("the liveness marker", () => {
  const live = loopStatsKeys("2026-08-09", LOOP_SURFACES).live;

  it("is written by the first recorded event of any kind, so a real zero is not 'no data'", async () => {
    for (const record of [
      () => recordLoopImpression("join_footer"),
      () => recordLoopClick("join_footer"),
      () => recordLoopThrottled(),
      () => recordGameStart(1),
    ]) {
      kv.incrs = [];
      __resetLivenessForTests();
      await record();
      expect(keysWritten()).toContain(live);
    }
  });

  it("is not rewritten by later events from the same instance", async () => {
    // Its reader (`scripts/loop-stats.mjs`) only asks whether the count is
    // above zero, so every write after the first was a command spent on an
    // answer already in KV — and it was spent on *every* counter, doubling the
    // cost of the whole namespace.
    await recordLoopImpression("join_footer");
    kv.incrs = [];
    await recordLoopClick("join_footer");
    expect(keysWritten()).not.toContain(live);
  });

  it("costs one command per metric, plus the marker once", async () => {
    // recordGameStart is the worst case: three metrics, which used to mean six
    // commands because each carried its own copy of the marker.
    await recordGameStart(2);
    const marker = kv.incrs.filter((i) => i.key === live);
    expect(marker).toHaveLength(1);
    expect(kv.incrs).toHaveLength(4);
  });

  it("adds exactly one command for a mixed game, and none for any other", async () => {
    // The rejected design was a second pulse event for the pool, which would
    // have carried its own liveness marker: eight commands for a repeat host's
    // mixed game where this costs five. Pinning the number is what stops that
    // creeping back in as "just one more counter".
    await recordGameStart(2, "room");
    expect(kv.incrs).toHaveLength(5);

    // Reset the marker memo so the second call pays for it too, otherwise the
    // comparison is 5-with-a-marker against 3-without and measures the memo
    // rather than the mixed counter.
    kv.incrs = [];
    __resetLivenessForTests();
    await recordGameStart(2);
    expect(kv.incrs).toHaveLength(4);
  });

  it("does not write a mixed key for a single-playlist game", async () => {
    await recordGameStart(1);
    expect(keysWritten().some((k) => k.includes("mixed_pool"))).toBe(false);
  });

  it("retries the marker on a later event when its write failed", async () => {
    // Marking it written before knowing the write landed would cost the day's
    // liveness to a single unlucky request — and a missing marker reads as
    // "the counters never ran", the loudest wrong answer this file can give.
    kv.failWrites = true;
    await recordLoopClick("share");
    kv.failWrites = false;

    kv.incrs = [];
    await recordLoopClick("share");
    expect(keysWritten()).toContain(live);
  });
});

describe("host game index", () => {
  it("counts a repeat host only from the second game on", async () => {
    const repeat = loopStatsKeys("2026-08-09", LOOP_SURFACES).repeatHost;

    await recordGameStart(1);
    expect(keysWritten()).not.toContain(repeat);

    kv.incrs = [];
    await recordGameStart(2);
    expect(keysWritten()).toContain(repeat);
  });

  it("caps the key space, so a scripted counter cannot fill KV", async () => {
    await recordGameStart(9_999);
    expect(keysWritten()).toContain(
      `loop:stats:2026-08-09:host_index:${HOST_INDEX_CEILING}`
    );
  });

  it("clamps nonsense from a corrupted client counter to a first game", async () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.7]) {
      kv.incrs = [];
      await recordGameStart(bad);
      expect(keysWritten()).toContain("loop:stats:2026-08-09:host_index:1");
    }
  });
});

describe("fail-soft", () => {
  it("swallows a KV outage rather than failing the caller's request", async () => {
    kv.failWrites = true;
    await expect(recordLoopClick("share")).resolves.toBeUndefined();
    await expect(recordGameStart(2)).resolves.toBeUndefined();
    await expect(recordLoopThrottled()).resolves.toBeUndefined();
    await expect(
      recordQuizCreated({ questionCount: 20, requestedCount: 50, locale: "en" })
    ).resolves.toBeUndefined();
    await expect(
      recordQuizCompleted({ questionCount: 20, verdict: "stranger" })
    ).resolves.toBeUndefined();
    await expect(recordQuizHint("found", true)).resolves.toBeUndefined();
    await expect(recordQuizThrottled("answer")).resolves.toBeUndefined();
    await expect(recordGameEnd("ended_early", 2)).resolves.toBeUndefined();
    await expect(recordPlaylistRefused("playlist_editorial")).resolves.toBeUndefined();
    await expect(recordQuizShare("owner", "dismissed")).resolves.toBeUndefined();
  });
});

describe("TTL", () => {
  it("outlives the digest window, which ends days back and reads a week", async () => {
    // A 7-day TTL would expire the oldest day of every report right before it
    // was read, and an expired key is indistinguishable from an unwritten one.
    await recordLoopClick("share");
    expect(LOOP_STATS_TTL_SECONDS).toBeGreaterThanOrEqual(14 * 24 * 60 * 60);
    for (const write of kv.incrs) {
      expect(write.ttl).toBe(LOOP_STATS_TTL_SECONDS);
    }
  });
});

describe("the digest prints what the recorders write", () => {
  // `scripts/loop-stats.mjs` is an .mjs with no path to these constants, so
  // it names each stage by hand — and `quiz:` is one of the prefixes its
  // "Other counters" fallback treats as already rendered. A stage added to
  // `QUIZ_STAGES` and not to the script is therefore consumed and printed
  // nowhere: the counter moves in KV and no line in `npm run stats` moves
  // with it, which is the failure CLAUDE.md names and this file cannot see
  // through the recorders alone. Read the source, the way the .tsx tests do.
  const script = readFileSync(join(process.cwd(), "scripts/loop-stats.mjs"), "utf8");

  it("reads and prints a row for every quiz stage", () => {
    for (const stage of QUIZ_STAGES) {
      expect(script, `stage ${stage} is never read`).toMatch(new RegExp(`get\\("quiz:${stage}"\\)`));
      // Its row: the stage name at the head of a console.log line, padded.
      expect(script, `stage ${stage} is never printed`).toMatch(new RegExp(`console\\.log\\(\\s*\`  ${stage}\\s+\\$\\{`));
    }
    // And the guard that decides whether the block prints at all sums every
    // stage, so a day with only starts is not a day with no quiz activity.
    const guard = script.match(/if \(([^)]*) > 0\) \{\s*console\.log\("\\nPlaylist quiz/)?.[1] ?? "";
    for (const stage of QUIZ_STAGES) {
      expect(guard, `guard omits ${stage}`).toMatch(new RegExp(`quiz${stage[0].toUpperCase()}${stage.slice(1)}`));
    }
  });

  it("treats every recorder prefix as rendered, so no counter is printed twice", () => {
    // The mirror image: a prefix the script renders in its own block but
    // forgot to list here would print again under "Other counters".
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    for (const prefix of [
      "quiz:",
      "quiz_verdict:",
      "quiz_len:",
      "quiz_locale:",
      "quiz_hint:",
      "quiz_throttled:",
      "quiz_share:",
      "game_end:",
      "game_end_round:",
      "playlist_refused:",
    ]) {
      expect(rendered).toContain(`"${prefix}"`);
    }
    // Throttled routes are rendered by prefix, so `check` needs no line of its own.
    for (const route of QUIZ_THROTTLED_ROUTES) {
      expect(script).not.toMatch(new RegExp(`get\\("quiz_throttled:${route}"\\)`));
    }
    expect(script).toMatch(/m\.startsWith\("quiz_throttled:"\)/);
  });

  it("reads both game ends, every share pair, and the refusal prefix", () => {
    // Each of these is under a prefix RENDERED_PREFIXES now claims, so a
    // key the script does not actually read is consumed and printed nowhere.
    for (const end of GAME_ENDS) {
      expect(script, `${end} is never read`).toMatch(new RegExp(`get\\("game_end:${end}"\\)`));
    }
    expect(script).toMatch(/m\.startsWith\("game_end_round:"\)/);
    // Shares are read by template over the two lists the script mirrors.
    const bys = script.match(/for \(const by of \[([^\]]*)\]\)/)?.[1] ?? "";
    for (const by of QUIZ_SHARE_BYS) expect(bys).toContain(`"${by}"`);
    const outcomes = script.match(/const shareOutcomes = \[([^\]]*)\]/)?.[1] ?? "";
    for (const outcome of QUIZ_SHARE_OUTCOMES) expect(outcomes).toContain(`"${outcome}"`);
    expect(script).toMatch(/m\.startsWith\("playlist_refused:"\)/);
    // And the ceiling label agrees with the writer's cap.
    expect(script).toContain(`const GAME_ROUND_CEILING = ${GAME_ROUND_CEILING};`);
  });
});
