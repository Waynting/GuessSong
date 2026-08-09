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
  loopStatsKeys,
  recordGameStart,
  recordLoopClick,
  recordLoopImpression,
  recordLoopThrottled,
} = await import("@/lib/loop-stats");

beforeEach(() => {
  kv.incrs = [];
  kv.failWrites = false;
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
});

describe("the liveness marker", () => {
  it("is bumped by every recorded event, so a real zero is not 'no data'", async () => {
    const live = loopStatsKeys("2026-08-09", LOOP_SURFACES).live;
    for (const record of [
      () => recordLoopImpression("join_footer"),
      () => recordLoopClick("join_footer"),
      () => recordLoopThrottled(),
    ]) {
      kv.incrs = [];
      await record();
      expect(keysWritten()).toContain(live);
    }
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
