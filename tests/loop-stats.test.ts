import { describe, it, expect, vi, beforeEach } from "vitest";
import { LOOP_SURFACES } from "@/lib/loop-links";

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
  HOST_INDEX_CEILING,
  LOOP_STATS_TTL_SECONDS,
  MIXED_SUB_MODES,
  loopStatsKeys,
  recordGameStart,
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
