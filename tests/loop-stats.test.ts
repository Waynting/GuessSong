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
  EARLY_END_BANDS,
  FIRST_CLIP_OUTCOMES,
  FIRST_CLIP_PATHS,
  GAME_ENDS,
  GAME_HOST_KINDS,
  GAME_OVER_TAPS,
  GAME_ROUND_CEILING,
  GAME_ROUND_FLOOR,
  GAME_SCREENS,
  earlyEndBand,
  recordFirstClip,
  recordGameLeft,
  recordGameOverTap,
  HOST_INDEX_CEILING,
  LOOP_STATS_TTL_SECONDS,
  MIXED_SUB_MODES,
  SETUP_SOURCES,
  PLAYLIST_REFUSAL_CODES,
  PLAYLIST_INVALID_KINDS,
  SHORTLINK_OUTCOMES,
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
  recordPlaylistInvalid,
  recordShortlinkOutcome,
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

    for (const source of SETUP_SOURCES) {
      kv.incrs = [];
      await recordGameStart(1, undefined, source);
      expect(keysWritten()).toContain(expected.hostSetup[source]);
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
    expect(keysWritten()).toContain(expected.gameEndRound[5]); // game_end_round:5

    for (const host of GAME_HOST_KINDS) {
      for (const end of GAME_ENDS) {
        kv.incrs = [];
        await recordGameEnd(end, 5, { host });
        expect(keysWritten()).toContain(expected.gameEndHost[host][end]);
      }
      for (const [round, band] of [[0, "r0"], [2, "r1_2"], [9, "r3_plus"]] as const) {
        kv.incrs = [];
        await recordGameEnd("ended_early", round, { host });
        expect(keysWritten()).toContain(expected.gameEndEarly[host][band]);
        kv.incrs = [];
        await recordGameLeft(round, host);
        expect(keysWritten()).toContain(expected.gameLeftRound[round]);
        expect(keysWritten()).toContain(expected.gameLeftHost[host][band]);
      }
    }

    for (const screen of GAME_SCREENS) {
      kv.incrs = [];
      await recordGameEnd("played_out", 20, { screen });
      expect(keysWritten()).toContain(expected.gameEndScreen[screen]);
    }

    for (const path of FIRST_CLIP_PATHS) {
      for (const outcome of FIRST_CLIP_OUTCOMES) {
        kv.incrs = [];
        await recordFirstClip(path, outcome);
        expect(keysWritten()).toContain(expected.firstClip[path][outcome]);
      }
    }

    for (const target of GAME_OVER_TAPS) {
      kv.incrs = [];
      await recordGameOverTap(target);
      expect(keysWritten()).toContain(expected.gameOverTap[target]);
    }

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

  it("names a key for every declared setup source", () => {
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    for (const source of SETUP_SOURCES) {
      expect(keys.hostSetup[source]).toBe(`loop:stats:2026-08-09:host_setup:${source}`);
    }
    expect(Object.keys(keys.hostSetup)).toHaveLength(SETUP_SOURCES.length);
    expect(new Set(SETUP_SOURCES).size).toBe(SETUP_SOURCES.length);
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
    // Indexed by round, zero included: `[n]` is round n's key.
    expect(GAME_ROUND_FLOOR).toBe(0);
    expect(keys.gameEndRound).toHaveLength(GAME_ROUND_CEILING + 1);
    expect(keys.gameEndRound[0]).toBe("loop:stats:2026-08-09:game_end_round:0");
    expect(keys.gameEndRound[1]).toBe("loop:stats:2026-08-09:game_end_round:1");
    expect(keys.gameEndRound[GAME_ROUND_CEILING]).toBe(
      `loop:stats:2026-08-09:game_end_round:${GAME_ROUND_CEILING}`
    );
    expect(keys.gameLeftRound).toHaveLength(GAME_ROUND_CEILING + 1);
    expect(keys.gameLeftRound[0]).toBe("loop:stats:2026-08-09:game_left_round:0");
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
    expect(keysWritten()).toContain(keys.gameEndRound[3]);
  });

  it("caps the round key space, so a scripted counter cannot fill KV", async () => {
    await recordGameEnd("ended_early", 9_999);
    expect(keysWritten()).toContain(`loop:stats:2026-08-09:game_end_round:${GAME_ROUND_CEILING}`);
  });

  it("files round zero under its own key, and rounds one and up where they always were", async () => {
    // Zero used to be clamped up to one, so "ended at round 1" was partly
    // games that never played a clip. Rounds 1–20 must keep their meaning:
    // the histogram is read week against week.
    await recordGameEnd("ended_early", 0);
    expect(keysWritten()).toContain("loop:stats:2026-08-09:game_end_round:0");
    expect(keysWritten()).not.toContain("loop:stats:2026-08-09:game_end_round:1");

    for (const round of [1, 2, 7, GAME_ROUND_CEILING]) {
      kv.incrs = [];
      await recordGameEnd("ended_early", round);
      expect(keysWritten()).toContain(`loop:stats:2026-08-09:game_end_round:${round}`);
    }
  });

  it("clamps nonsense to the floor and refuses an end it does not know", async () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      kv.incrs = [];
      await recordGameEnd("ended_early", bad);
      expect(keysWritten()).toContain(`loop:stats:2026-08-09:game_end_round:${GAME_ROUND_FLOOR}`);
    }
    kv.incrs = [];
    await recordGameEnd("abandoned" as never, 3);
    expect(kv.incrs).toEqual([]);
  });

  it("counts an older page's end exactly as before: the two original keys and nothing else", async () => {
    // A tab opened before the deploy sends no host kind and no screen. One
    // key for a played-out game, two for an early end, plus the marker —
    // and nothing filed under `unknown`, which is a different fact.
    await recordGameEnd("played_out", 20);
    expect(keysWritten()).toEqual([keys.gameEnd.played_out, keys.live]);

    kv.incrs = [];
    await recordGameEnd("ended_early", 4);
    expect(keysWritten()).toEqual([keys.gameEnd.ended_early, keys.gameEndRound[4]]);

    kv.incrs = [];
    await recordGameEnd("ended_early", 4, {});
    expect(keysWritten().some((k) => /game_end_(host|early|screen):/.test(k))).toBe(false);
  });

  it("joins the end to the host kind, and bands the round only for an early end", async () => {
    await recordGameEnd("played_out", 20, { host: "repeat" });
    expect(keysWritten()).toContain(keys.gameEndHost.repeat.played_out);
    expect(keysWritten().some((k) => k.includes("game_end_early:"))).toBe(false);

    kv.incrs = [];
    await recordGameEnd("ended_early", 1, { host: "first", screen: "phone" });
    const written = keysWritten();
    expect(written).toContain(keys.gameEnd.ended_early);
    expect(written).toContain(keys.gameEndRound[1]);
    expect(written).toContain(keys.gameEndHost.first.ended_early);
    expect(written).toContain(keys.gameEndEarly.first.r1_2);
    expect(written).toContain(keys.gameEndScreen.phone);
    expect(written).toHaveLength(5);
  });

  it("refuses a host kind or a screen it does not know, and still counts the end", async () => {
    await recordGameEnd("ended_early", 2, { host: "regular" as never, screen: "tablet" as never });
    expect(keysWritten()).toEqual([keys.gameEnd.ended_early, keys.live, keys.gameEndRound[2]]);
  });

  it("bands the early rounds where the reading rule draws its lines", () => {
    expect(earlyEndBand(0)).toBe("r0");
    expect(earlyEndBand(1)).toBe("r1_2");
    expect(earlyEndBand(2)).toBe("r1_2");
    expect(earlyEndBand(3)).toBe("r3_plus");
    expect(earlyEndBand(GAME_ROUND_CEILING)).toBe("r3_plus");
    expect(EARLY_END_BANDS).toEqual(["r0", "r1_2", "r3_plus"]);
  });
});

describe("the first clip, a game left, and a tap on Game Over", () => {
  const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);

  it("names a key for every host kind × band, every first-clip pair, both screens and both taps", () => {
    for (const host of GAME_HOST_KINDS) {
      for (const end of GAME_ENDS) {
        expect(keys.gameEndHost[host][end]).toBe(`loop:stats:2026-08-09:game_end_host:${host}:${end}`);
      }
      for (const band of EARLY_END_BANDS) {
        expect(keys.gameEndEarly[host][band]).toBe(`loop:stats:2026-08-09:game_end_early:${host}:${band}`);
        expect(keys.gameLeftHost[host][band]).toBe(`loop:stats:2026-08-09:game_left_host:${host}:${band}`);
      }
    }
    expect(Object.keys(keys.gameEndHost)).toHaveLength(GAME_HOST_KINDS.length);
    for (const path of FIRST_CLIP_PATHS) {
      expect(Object.keys(keys.firstClip[path])).toHaveLength(FIRST_CLIP_OUTCOMES.length);
      for (const outcome of FIRST_CLIP_OUTCOMES) {
        expect(keys.firstClip[path][outcome]).toBe(`loop:stats:2026-08-09:first_clip:${path}:${outcome}`);
      }
    }
    expect(Object.keys(keys.firstClip)).toHaveLength(FIRST_CLIP_PATHS.length);
    for (const screen of GAME_SCREENS) {
      expect(keys.gameEndScreen[screen]).toBe(`loop:stats:2026-08-09:game_end_screen:${screen}`);
    }
    expect(Object.keys(keys.gameEndScreen)).toHaveLength(GAME_SCREENS.length);
    for (const target of GAME_OVER_TAPS) {
      expect(keys.gameOverTap[target]).toBe(`loop:stats:2026-08-09:game_over_tap:${target}`);
    }
    expect(Object.keys(keys.gameOverTap)).toHaveLength(GAME_OVER_TAPS.length);
  });

  it("refuses a first clip whose path or outcome is undeclared — both are key tails", async () => {
    await recordFirstClip("cached" as never, "played");
    await recordFirstClip("lazy", "NotAllowedError" as never);
    expect(kv.incrs).toEqual([]);
  });

  it("writes a leave's round from zero up, capped, with the end beacon's arithmetic", async () => {
    await recordGameLeft(0);
    expect(keysWritten()).toEqual([keys.gameLeftRound[0], keys.live]);

    kv.incrs = [];
    await recordGameLeft(9_999, "repeat");
    expect(keysWritten()).toEqual([
      keys.gameLeftRound[GAME_ROUND_CEILING],
      keys.gameLeftHost.repeat.r3_plus,
    ]);

    kv.incrs = [];
    await recordGameLeft(1, "regular" as never);
    expect(keysWritten()).toEqual([keys.gameLeftRound[1]]);
  });

  it("refuses a tap it does not know", async () => {
    await recordGameOverTap("save_results" as never);
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

  it("splits a 'not a playlist URL' refusal by what it was, and writes the total with it", async () => {
    // The split is a second reading of `playlist_refused:invalid_playlist_url`,
    // not a fifth refusal code. One call writes both, so the parts cannot
    // drift from the total they are parts of — and the weekly series that
    // read 748 before the split keeps counting exactly what it counted.
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    expect(PLAYLIST_INVALID_KINDS).toEqual(["album", "track", "artist", "shortlink", "other"]);
    expect(Object.keys(keys.playlistInvalid)).toHaveLength(PLAYLIST_INVALID_KINDS.length);
    expect(PLAYLIST_REFUSAL_CODES).toHaveLength(4);

    for (const kind of PLAYLIST_INVALID_KINDS) {
      kv.incrs = [];
      __resetLivenessForTests();
      await recordPlaylistInvalid(kind);
      expect(keys.playlistInvalid[kind]).toBe(`loop:stats:2026-08-09:playlist_invalid:${kind}`);
      expect(keysWritten()).toContain(keys.playlistInvalid[kind]);
      expect(keysWritten()).toContain(keys.playlistRefused.invalid_playlist_url);
      // The pair and the marker, once — not a marker each.
      expect(kv.incrs).toHaveLength(3);
      expect(kv.incrs.filter((i) => i.key === keys.live)).toHaveLength(1);
    }
  });

  it("refuses an undeclared kind outright — no part, and no total without its part", async () => {
    for (const kind of ["playlist", "episode", "", "album:x", "__proto__"]) {
      kv.incrs = [];
      await recordPlaylistInvalid(kind as never);
      expect(kv.incrs).toEqual([]);
    }
  });

  it("keys a followed short link by how it came out, from a closed set", async () => {
    const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
    expect(Object.keys(keys.playlistShortlink)).toHaveLength(SHORTLINK_OUTCOMES.length);
    for (const outcome of SHORTLINK_OUTCOMES) {
      kv.incrs = [];
      await recordShortlinkOutcome(outcome);
      expect(keys.playlistShortlink[outcome]).toBe(
        `loop:stats:2026-08-09:playlist_shortlink:${outcome}`
      );
      expect(keysWritten()).toContain(keys.playlistShortlink[outcome]);
    }
    kv.incrs = [];
    await recordShortlinkOutcome("timeout" as never);
    expect(kv.incrs).toEqual([]);

    kv.failWrites = true;
    await expect(recordPlaylistInvalid("album")).resolves.toBeUndefined();
    await expect(recordShortlinkOutcome("unavailable")).resolves.toBeUndefined();
  });

  it("refuses a share whose by or outcome is undeclared — both are key tails", async () => {
    await recordQuizShare("host" as never, "shared");
    await recordQuizShare("owner", "downloaded" as never);
    expect(kv.incrs).toEqual([]);
  });
});

describe("the quiz's owner, copy and source counters", () => {
  // Added 2026-09-30 for the step between "quiz created" and "quiz sent".
  // Imported here rather than in the list at the top of the file, which is
  // the one statement every new counter's tests have to touch.
  const added = import("@/lib/loop-stats");
  const sources = import("@/lib/quiz-source");
  const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);

  it("writes the owner's two stages under the funnel's prefix, and nothing beside them", async () => {
    const { QUIZ_OWNER_STAGES, recordQuizOwnerStage } = await added;
    expect([...QUIZ_OWNER_STAGES]).toEqual(["owner_opened", "owner_completed"]);
    expect(Object.keys(keys.quizOwner)).toHaveLength(QUIZ_OWNER_STAGES.length);
    for (const stage of QUIZ_OWNER_STAGES) {
      kv.incrs = [];
      __resetLivenessForTests();
      await recordQuizOwnerStage(stage);
      expect(keys.quizOwner[stage]).toBe(`loop:stats:2026-08-09:quiz:${stage}`);
      // One command and the marker: an owner's sheet is not a verdict and
      // not a row in the length table.
      expect(keysWritten().sort()).toEqual([keys.live, keys.quizOwner[stage]].sort());
    }
  });

  it("keeps the owner's stages out of the friends' funnel, in both directions", async () => {
    // `instead of, never as well as` is the routes' rule; this is the half of
    // it the key map can break — an owner stage named like a friend's, or
    // added to QUIZ_STAGES, where the script's funnel rows would count it.
    const { QUIZ_OWNER_STAGES } = await added;
    for (const stage of QUIZ_OWNER_STAGES) {
      expect(QUIZ_STAGES as readonly string[]).not.toContain(stage);
      expect(Object.values(keys.quiz)).not.toContain(keys.quizOwner[stage]);
    }
  });

  it("refuses an owner stage it does not know", async () => {
    const { recordQuizOwnerStage } = await added;
    for (const bad of ["owner_started", "opened", "completed", "", "__proto__"]) {
      await recordQuizOwnerStage(bad as never);
    }
    expect(kv.incrs).toEqual([]);
  });

  it("keys a Copy tap apart from a share, for every by", async () => {
    const { QUIZ_COPY_OUTCOMES, recordQuizCopy } = await added;
    expect([...QUIZ_COPY_OUTCOMES]).toEqual(["copied", "failed"]);
    expect(Object.keys(keys.quizCopy)).toHaveLength(QUIZ_SHARE_BYS.length);
    for (const by of QUIZ_SHARE_BYS) {
      expect(Object.keys(keys.quizCopy[by])).toHaveLength(QUIZ_COPY_OUTCOMES.length);
      for (const outcome of QUIZ_COPY_OUTCOMES) {
        kv.incrs = [];
        await recordQuizCopy(by, outcome);
        expect(keys.quizCopy[by][outcome]).toBe(`loop:stats:2026-08-09:quiz_copy:${by}:${outcome}`);
        expect(keysWritten()).toContain(keys.quizCopy[by][outcome]);
        // The whole point: a Copy tap must not land on the share's `copied`.
        expect(keysWritten().some((k) => k.includes("quiz_share:"))).toBe(false);
      }
    }
  });

  it("does the same the other way: a share's fallback never lands on the copy key", async () => {
    for (const by of QUIZ_SHARE_BYS) {
      kv.incrs = [];
      await recordQuizShare(by, "copied");
      expect(keysWritten()).toContain(keys.quizShare[by].copied);
      expect(keysWritten().some((k) => k.includes("quiz_copy:"))).toBe(false);
    }
  });

  it("refuses a copy whose by or outcome is undeclared — a sheet's outcomes are not a clipboard's", async () => {
    const { recordQuizCopy } = await added;
    await recordQuizCopy("host" as never, "copied");
    await recordQuizCopy("owner", "shared" as never);
    await recordQuizCopy("owner", "dismissed" as never);
    await recordQuizCopy("board", "" as never);
    expect(kv.incrs).toEqual([]);
  });

  it("counts the results page as a third sharer, beside the owner and the taker", () => {
    expect([...QUIZ_SHARE_BYS]).toEqual(["owner", "taker", "board"]);
    for (const outcome of QUIZ_SHARE_OUTCOMES) {
      expect(keys.quizShare.board[outcome]).toBe(`loop:stats:2026-08-09:quiz_share:board:${outcome}`);
    }
  });

  it("records where a quiz's maker came from, for every member of the closed set", async () => {
    const { QUIZ_SOURCES } = await sources;
    expect(Object.keys(keys.quizFrom)).toHaveLength(QUIZ_SOURCES.length);
    for (const from of QUIZ_SOURCES) {
      kv.incrs = [];
      await recordQuizCreated({ questionCount: 10, requestedCount: 10, locale: "en", from });
      expect(keys.quizFrom[from]).toBe(`loop:stats:2026-08-09:quiz_from:${from}`);
      const written = keysWritten();
      expect(written).toContain(keys.quizFrom[from]);
      expect(written.filter((k) => k.includes("quiz_from:"))).toHaveLength(1);
      // Beside the creation, not in place of it.
      expect(written).toContain(keys.quiz.created);
      expect(written).toContain(keys.quizLength.created[10]);
    }
  });

  it("counts the creation and no source when none was named, or one it does not know", async () => {
    // Not `none`: that is a fact about a referrer, and would be a lie about
    // a request that never said.
    for (const from of [undefined, "", "organic", "None", "https://www.google.com/", "__proto__", 7, null]) {
      kv.incrs = [];
      await recordQuizCreated({ questionCount: 10, requestedCount: 10, locale: "en", from: from as never });
      expect(keysWritten(), String(from)).toContain(keys.quiz.created);
      expect(keysWritten().some((k) => k.includes("quiz_from")), String(from)).toBe(false);
    }
  });

  it("stays fail-soft", async () => {
    const { recordQuizCopy, recordQuizOwnerStage } = await added;
    kv.failWrites = true;
    await expect(recordQuizCopy("board", "failed")).resolves.toBeUndefined();
    await expect(recordQuizOwnerStage("owner_completed")).resolves.toBeUndefined();
    await expect(
      recordQuizCreated({ questionCount: 10, requestedCount: 10, locale: "en", from: "external" })
    ).resolves.toBeUndefined();
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

describe("how the playlist got into the field", () => {
  const keys = loopStatsKeys("2026-08-09", LOOP_SURFACES);
  const setupKeys = () => keysWritten().filter((k) => k.includes(":host_setup:"));

  it("counts a game from a page that sent no source exactly as it always was", async () => {
    // Every tab open across the deploy is such a page. It must add nothing
    // under `host_setup:` and lose nothing anywhere else.
    await recordGameStart(3);
    expect(setupKeys()).toEqual([]);
    expect(keysWritten()).toEqual([keys.games, keys.live, keys.hostIndex[2], keys.repeatHost]);
  });

  it("adds exactly one command for a game that said, and keys nothing else differently", async () => {
    await recordGameStart(3, undefined, "restored");
    expect(setupKeys()).toEqual([keys.hostSetup.restored]);
    expect(kv.incrs).toHaveLength(5);
    expect(keysWritten()).toEqual([
      keys.games,
      keys.live,
      keys.hostIndex[2],
      keys.repeatHost,
      keys.hostSetup.restored,
    ]);
  });

  it("records a mixed game under both its pool and its source", async () => {
    await recordGameStart(1, "phone", "mixed");
    expect(keysWritten()).toContain(keys.mixedPool.phone);
    expect(setupKeys()).toEqual([keys.hostSetup.mixed]);
  });

  it("refuses a source outside the list, and still counts the game", async () => {
    // The value becomes the tail of a key, and the body that carried it
    // reached /api/pulse from the open internet.
    for (const bad of ["Typed", "pasted", "", "__proto__", "constructor", "typed ", "a".repeat(500)]) {
      kv.incrs = [];
      __resetLivenessForTests();
      await recordGameStart(1, undefined, bad as never);
      expect(setupKeys(), bad).toEqual([]);
      expect(keysWritten(), bad).toContain(keys.games);
    }
  });

  it("keeps the key space at the six declared sources", async () => {
    for (const source of SETUP_SOURCES) await recordGameStart(1, undefined, source);
    expect(new Set(setupKeys()).size).toBe(SETUP_SOURCES.length);
    expect([...SETUP_SOURCES]).toEqual(["typed", "restored", "recent", "starter", "shared", "mixed"]);
  });

  it("is swallowed with the rest when KV is down", async () => {
    kv.failWrites = true;
    await expect(recordGameStart(2, "room", "mixed")).resolves.toBeUndefined();
    await expect(recordGameStart(2, undefined, "recent")).resolves.toBeUndefined();
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
    await expect(
      recordGameEnd("ended_early", 0, { host: "first", screen: "phone" })
    ).resolves.toBeUndefined();
    await expect(recordGameLeft(3, "repeat")).resolves.toBeUndefined();
    await expect(recordFirstClip("lazy", "rejected")).resolves.toBeUndefined();
    await expect(recordGameOverTap("mixed")).resolves.toBeUndefined();
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

  it("prints the split under the refusals, and the short links on their own", () => {
    // Both are new prefixes, so without an entry in RENDERED_PREFIXES they
    // would print twice — once here and once, raw, under "Other counters" —
    // and with one but no reader they would be consumed and printed nowhere.
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"playlist_invalid:"');
    expect(rendered).toContain('"playlist_shortlink:"');

    // Read by name over the writer's closed sets, every member of each.
    const kinds = script.match(/const invalidKinds = \[([\s\S]*?)\n  \];/)?.[1] ?? "";
    for (const kind of PLAYLIST_INVALID_KINDS) expect(kinds, kind).toContain(`["${kind}",`);
    expect(script).toMatch(/get\(`playlist_invalid:\$\{k\}`\)/);
    const outcomes = script.match(/const shortlinkOutcomes = \[([\s\S]*?)\n\];/)?.[1] ?? "";
    for (const outcome of SHORTLINK_OUTCOMES) expect(outcomes, outcome).toContain(`["${outcome}",`);
    expect(script).toMatch(/get\(`playlist_shortlink:\$\{o\}`\)/);

    // Directly under the line it splits, inside the block that prints it.
    const refused = script.indexOf("Playlist links refused —");
    const split = script.indexOf("not a playlist URL, by what it was");
    const editorial = script.indexOf("a quarter or more are Spotify's own playlists");
    expect(refused).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(refused);
    expect(editorial).toBeGreaterThan(split);
  });

  it("renders the setup sources under the games block, and claims their prefix", () => {
    // `host_setup:` is a new prefix, so without its own renderer it would
    // have fallen to "Other counters" as six unexplained rows — and with the
    // prefix claimed but nothing reading it, to nowhere at all.
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"host_setup:"');
    expect(script).toMatch(/m\.startsWith\("host_setup:"\)/);
    expect(script).toMatch(/console\.log\(`Playlist came from/);
    // The order it prints in is the order the writer declares.
    const order = script.match(/const SETUP_SOURCE_ORDER = \[([^\]]*)\]/)?.[1] ?? "";
    expect(order.match(/"([a-z]+)"/g)?.map((s) => s.slice(1, -1))).toEqual([...SETUP_SOURCES]);
    // The two it adds up are read by name, so they have to be real ones.
    for (const source of ["restored", "recent", "mixed"] as const) {
      expect(SETUP_SOURCES).toContain(source);
      expect(script).toMatch(new RegExp(`get\\("host_setup:${source}"\\)`));
    }
    // And it sits with the game starts: after Repeat hosts, before the ends.
    const at = script.indexOf("Playlist came from");
    expect(at).toBeGreaterThan(script.indexOf("`Repeat hosts"));
    expect(at).toBeLessThan(script.indexOf("`Reached Game Over"));
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

  it("reads and prints the owner's two stages, which sit under a prefix the fallback skips", async () => {
    // `quiz:owner_opened` starts with `quiz:`, so "Other counters" will never
    // show it. Without a read and a row of its own it is the counter that
    // moves in KV and nowhere in `npm run stats`.
    const { QUIZ_OWNER_STAGES } = await import("@/lib/loop-stats");
    for (const stage of QUIZ_OWNER_STAGES) {
      const name = stage.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
      const variable = `quiz${name[0].toUpperCase()}${name.slice(1)}`;
      expect(script, `${stage} is never read`).toContain(`const ${variable} = get("quiz:${stage}");`);
      // Read, and then used in a printed row — not only in the guard.
      const printed = script.match(/console\.log\(\s*`  owner \w+\$\{String\((\w+)\)\.padStart\(6\)\}/g) ?? [];
      expect(printed.some((row) => row.includes(`String(${variable})`)), `${stage} is never printed`).toBe(true);
      const guard = script.match(/if \(([^)]*) > 0\) \{\s*console\.log\("\\nPlaylist quiz/)?.[1] ?? "";
      expect(guard, `guard omits ${stage}`).toContain(variable);
    }
  });

  it("reads every copy pair and every source, and claims both prefixes", async () => {
    const { QUIZ_COPY_OUTCOMES } = await import("@/lib/loop-stats");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    for (const prefix of ["quiz_copy:", "quiz_from:"]) expect(rendered).toContain(`"${prefix}"`);

    // Copies are read by template over two lists the script mirrors, like shares.
    const outcomes = script.match(/const copyOutcomes = \[([^\]]*)\]/)?.[1] ?? "";
    for (const outcome of QUIZ_COPY_OUTCOMES) expect(outcomes).toContain(`"${outcome}"`);
    expect(script).toMatch(/get\(`quiz_copy:\$\{by\}:\$\{o\}`\)/);
    // Both loops name every `by` — the share loop is the first, the copy
    // loop the second, and a `by` missing from either is a row never printed.
    const loops = [...script.matchAll(/for \(const by of \[([^\]]*)\]\)/g)].map((m) => m[1]);
    expect(loops).toHaveLength(2);
    for (const loop of loops) {
      for (const by of QUIZ_SHARE_BYS) expect(loop).toContain(`"${by}"`);
    }
    // Each `by` is read against something: a row with no denominator named
    // for it would borrow another's.
    expect(script).toMatch(/by === "owner"[\s\S]{0,80}of quizzes/);
    expect(script).toMatch(/by === "board"[\s\S]{0,80}of board opens/);

    // Sources are discovered by prefix, so a loop surface added later prints
    // under its own name without an edit to the script.
    expect(script).toMatch(/m\.startsWith\("quiz_from:"\)/);
    expect(script).toMatch(/get\(`quiz_from:\$\{s\}`\)/);
  });

  it("prints the quiz block for a window whose only activity is a tap or a preview", () => {
    // The panel is drawn for a remembered quiz now, so an owner can send a
    // link on a day nothing was created or opened. A guard that summed only
    // the five stages would swallow that day's counters whole.
    const guard = script.match(/if \(([^)]*) > 0\) \{\s*console\.log\("\\nPlaylist quiz/)?.[1] ?? "";
    expect(guard).toContain("quizTaps");
    expect(script).toMatch(
      /const quizTaps = \[\.\.\.totals\]\s*\.filter\(\(\[m\]\) => m\.startsWith\("quiz_share:"\) \|\| m\.startsWith\("quiz_copy:"\)\)/
    );
  });

  it("says, where it prints them, that copied changed meaning and when", () => {
    // A reader comparing weeks across 2026-09-30 sees `owner share … copied`
    // fall and has nothing else on screen to explain it.
    expect(script).toContain("2026-09-30");
    expect(script).toMatch(/Days before 2026-09-30 filed both as a share's copied/);
  });

  it("claims and reads every prefix the game page's beacons write", () => {
    // Seven prefixes, each rendered by its own block. One that is claimed
    // and not read is a counter that moves in KV and prints nowhere; one
    // that is read and not claimed prints twice.
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    for (const prefix of [
      "game_end_host:",
      "game_end_early:",
      "game_end_screen:",
      "game_left_round:",
      "game_left_host:",
      "first_clip:",
      "game_over_tap:",
    ]) {
      expect(rendered, `${prefix} is not claimed`).toContain(`"${prefix}"`);
    }
    expect(script).toMatch(/m\.startsWith\("game_left_round:"\)/);
    for (const screen of GAME_SCREENS) {
      expect(script, `${screen} is never read`).toMatch(new RegExp(`get\\("game_end_screen:${screen}"\\)`));
    }
    for (const target of GAME_OVER_TAPS) {
      expect(script, `${target} is never read`).toMatch(new RegExp(`get\\("game_over_tap:${target}"\\)`));
    }
    // The rest are read by template over lists the script mirrors by hand,
    // so the lists are what has to agree with the writer's.
    const literal = (name: string) =>
      script.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? "";
    /** `["a", "b"]` — every string in it. */
    const flat = (name: string) => [...literal(name).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
    /** `[["a", "label"], …]` — the key of each pair, never its label. */
    const heads = (name: string) => [...literal(name).matchAll(/\["([a-z0-9_]+)",/g)].map((m) => m[1]);
    expect(flat("hostKinds")).toEqual([...GAME_HOST_KINDS]);
    expect(heads("earlyBands")).toEqual([...EARLY_END_BANDS]);
    expect(flat("clipPaths")).toEqual([...FIRST_CLIP_PATHS]);
    expect(heads("clipOutcomes")).toEqual([...FIRST_CLIP_OUTCOMES]);
    for (const template of [
      "`${prefix}:${k}:${tail}`",
      "`game_left_host:${k}:${band}`",
      "`first_clip:${p}:${o}`",
      "`first_clip:${p}:${outcome}`",
    ]) {
      expect(script, `${template} is never read`).toContain(template);
    }
    expect(script).toMatch(/byHost\("game_end_host", "played_out"\)/);
    expect(script).toMatch(/byHost\("game_end_host", "ended_early"\)/);
    expect(script).toMatch(/byHost\("game_end_early", band\)/);
    expect(script).toMatch(/byHost\("game_left_host", band\)/);
  });

  it("labels round zero on its own row, in both histograms, so nobody reads it as a round", () => {
    expect(script).toMatch(/const ROUND_ZERO_NOTE = "[^"]*no clip had started"/);
    expect(script.match(/\(n === 0 \? ROUND_ZERO_NOTE : ""\)/g) ?? []).toHaveLength(2);
  });

  it("stops calling the remainder 'closed the tab' once leaves are counted", () => {
    // The old line named the whole gap after something nothing had counted.
    // With a leave beacon the gap is only what sent neither, and the old
    // sentence must be reachable only when there are no leaves to subtract.
    expect(script).toMatch(
      /if \(leftMidGame > 0\) \{[\s\S]*?sent neither beacon[\s\S]*?\} else if \(games > reachedEnd\) \{[\s\S]*?closed the tab mid-game/
    );
    expect(script).toMatch(/const unaccounted = games - reachedEnd - leftMidGame;/);
  });
});
