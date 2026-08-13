import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { dayBucket, getKvStore } from "@/lib/kv";

const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  mget: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  incr: vi.fn(),
  incrby: vi.fn(),
  expire: vi.fn(),
  hgetall: vi.fn(),
  hsetnx: vi.fn(),
  hdel: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redisMock },
}));

describe("getKvStore (in-memory fallback)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a value through get/set", async () => {
    const store = await getKvStore();
    await store.set("k1", { hello: "world" }, 60);
    expect(await store.get("k1")).toEqual({ hello: "world" });
  });

  it("returns null for a key that was never set", async () => {
    const store = await getKvStore();
    expect(await store.get("does-not-exist")).toBeNull();
  });

  it("deletes a key", async () => {
    const store = await getKvStore();
    await store.set("k2", "value", 60);
    await store.del("k2");
    expect(await store.get("k2")).toBeNull();
  });

  it("expires a key once its TTL has elapsed", async () => {
    vi.useFakeTimers();
    const store = await getKvStore();
    await store.set("k3", "value", 1);
    vi.advanceTimersByTime(1500);
    expect(await store.get("k3")).toBeNull();
  });

  it("increments a counter and returns the running count", async () => {
    const store = await getKvStore();
    expect(await store.incr("counter1", 60)).toBe(1);
    expect(await store.incr("counter1", 60)).toBe(2);
    expect(await store.incr("counter1", 60)).toBe(3);
  });

  it("increments by more than one for a caller that already knows its count", async () => {
    // The preview batch route claims budget and records stats for a whole game
    // at once; without this it would spend one command per track and undo the
    // saving mget just made.
    const store = await getKvStore();
    expect(await store.incr("counter3", 60, 12)).toBe(12);
    expect(await store.incr("counter3", 60, 3)).toBe(15);
    expect(await store.incr("counter3", 60)).toBe(16);
  });

  it("reads many keys in order, with null for the ones that aren't there", async () => {
    const store = await getKvStore();
    await store.set("m1", "one", 60);
    await store.set("m3", "three", 60);

    // Order and length must match the keys exactly — a shorter result would
    // misalign values onto the wrong keys, which for previews means the wrong
    // song's audio.
    expect(await store.mget(["m1", "missing", "m3"])).toEqual(["one", null, "three"]);
    expect(await store.mget([])).toEqual([]);
  });

  it("resets the counter once its TTL has elapsed", async () => {
    vi.useFakeTimers();
    const store = await getKvStore();
    expect(await store.incr("counter2", 1)).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(await store.incr("counter2", 1)).toBe(1);
  });

  it("reads a whole hash, and an absent key as an empty one", async () => {
    const store = await getKvStore();
    expect(await store.hgetall("no-such-hash")).toEqual({});

    await store.hsetnx("h1", "meta", { code: "AB7K" });
    await store.hsetnx("h1", "p:alice", { playerName: "Alice" });
    expect(await store.hgetall("h1")).toEqual({
      meta: { code: "AB7K" },
      "p:alice": { playerName: "Alice" },
    });
  });

  it("sets a hash field only when it is free, and says which happened", async () => {
    // The whole point of the primitive: lib/room.ts decides a race on this
    // boolean, so a store that reported success either way would silently let
    // two players share one name.
    const store = await getKvStore();
    expect(await store.hsetnx("h2", "p:alice", { tracks: 1 })).toBe(true);
    expect(await store.hsetnx("h2", "p:alice", { tracks: 99 })).toBe(false);
    expect(await store.hgetall("h2")).toEqual({ "p:alice": { tracks: 1 } });
  });

  it("removes a hash field", async () => {
    const store = await getKvStore();
    await store.hsetnx("h3", "a", 1);
    await store.hsetnx("h3", "b", 2);
    await store.hdel("h3", "a");
    expect(await store.hgetall("h3")).toEqual({ b: 2 });
  });

  it("leaves a hash immortal until expire is called, as Redis does", async () => {
    // HSETNX creates a key with no TTL. lib/room.ts is what makes sure the
    // second call follows, and it deletes the key if that call fails — a room
    // whose expiry never landed would hold its code forever.
    vi.useFakeTimers();
    const store = await getKvStore();
    await store.hsetnx("h4", "meta", { code: "CD8M" });

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(await store.hgetall("h4")).toEqual({ meta: { code: "CD8M" } });

    await store.expire("h4", 60);
    vi.advanceTimersByTime(61 * 1000);
    expect(await store.hgetall("h4")).toEqual({});
  });

  it("does not reset a hash's TTL when a later field is added", async () => {
    // A room that reset its expiry on every submit would outlive the
    // `expiresAt` it already handed its clients, and the roster poll uses that
    // value as its own stop condition.
    vi.useFakeTimers();
    const store = await getKvStore();
    await store.hsetnx("h5", "meta", 1);
    await store.expire("h5", 60);

    vi.advanceTimersByTime(50 * 1000);
    await store.hsetnx("h5", "p:late", 1);
    vi.advanceTimersByTime(11 * 1000);

    expect(await store.hgetall("h5")).toEqual({});
  });

  it("shares state across separate getKvStore() calls", async () => {
    // Regression: the memory store must live on globalThis, not a plain
    // module-scope variable — Next.js dev mode compiles each API route file
    // as its own bundle, so a module-scope Map ends up as a distinct
    // instance per route the first time it's compiled. That made a room
    // created via POST /api/room invisible to GET /api/room/[code]/status.
    const storeA = await getKvStore();
    await storeA.set("shared-key", "shared-value", 60);
    const storeB = await getKvStore();
    expect(await storeB.get("shared-key")).toBe("shared-value");
  });
});

describe("getKvStore (Upstash backend)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    Object.values(redisMock).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes to Upstash when the env vars are set", async () => {
    redisMock.get.mockResolvedValue({ hello: "world" });
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();
    const value = await store.get("k1");
    expect(redisMock.get).toHaveBeenCalledWith("k1");
    expect(value).toEqual({ hello: "world" });
  });

  it("returns null when Upstash has no value for the key", async () => {
    redisMock.get.mockResolvedValue(null);
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();
    expect(await store.get("missing")).toBeNull();
  });

  it("sets a value with the given TTL", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();
    await store.set("k2", "value", 120);
    expect(redisMock.set).toHaveBeenCalledWith("k2", "value", { ex: 120 });
  });

  it("deletes a key", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();
    await store.del("k3");
    expect(redisMock.del).toHaveBeenCalledWith("k3");
  });

  it("only sets the TTL on the first increment of a window, not later ones", async () => {
    // Regression: a get-then-set pair for rate limiting would race under
    // concurrent requests — incr() must rely on Redis's atomic INCR, and
    // only the request that starts a fresh window should reset its expiry,
    // or every increment would keep pushing the window back indefinitely.
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    redisMock.incr.mockResolvedValueOnce(1);
    const first = await store.incr("counter", 60);
    expect(first).toBe(1);
    expect(redisMock.expire).toHaveBeenCalledWith("counter", 60);

    redisMock.expire.mockClear();
    redisMock.incr.mockResolvedValueOnce(2);
    const second = await store.incr("counter", 60);
    expect(second).toBe(2);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it("uses INCRBY for a bulk increment, and still recognises it opening the window", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    // A batch that opens a window with +12 is the first increment of it, so
    // the TTL is its to set — keying that off `count === 1` would leave the
    // counter with no expiry and freeze the window open forever.
    redisMock.incrby.mockResolvedValueOnce(12);
    expect(await store.incr("budget", 60, 12)).toBe(12);
    expect(redisMock.incrby).toHaveBeenCalledWith("budget", 12);
    expect(redisMock.expire).toHaveBeenCalledWith("budget", 60);

    redisMock.expire.mockClear();
    redisMock.incrby.mockResolvedValueOnce(20);
    expect(await store.incr("budget", 60, 8)).toBe(20);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it("sends one MGET, and pads a short reply rather than misaligning it", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    redisMock.mget.mockResolvedValueOnce(["a", null]);
    expect(await store.mget(["k1", "k2", "k3"])).toEqual(["a", null, null]);
    expect(redisMock.mget).toHaveBeenCalledWith("k1", "k2", "k3");
  });

  it("never sends MGET with no keys, which Redis rejects", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    expect(await store.mget([])).toEqual([]);
    expect(redisMock.mget).not.toHaveBeenCalled();
  });

  it("turns HSETNX's 0/1 into the boolean the caller decides a race on", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    redisMock.hsetnx.mockResolvedValueOnce(1);
    expect(await store.hsetnx("room:v2:AB7K", "p:alice", { n: 1 })).toBe(true);
    redisMock.hsetnx.mockResolvedValueOnce(0);
    expect(await store.hsetnx("room:v2:AB7K", "p:alice", { n: 1 })).toBe(false);
  });

  it("reads a missing hash as empty rather than null", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    redisMock.hgetall.mockResolvedValueOnce(null);
    expect(await store.hgetall("room:v2:ZZZZ")).toEqual({});
  });

  it("decodes hash fields whether the client parsed them or not", async () => {
    // The client JSON-parses what it can and hands back the rest as the raw
    // string, so a room's `meta` object and its bare uuid `consumed` marker come
    // back in two different shapes. Guessing one of them is a crash mid-party.
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    redisMock.hgetall.mockResolvedValueOnce({
      meta: { code: "AB7K" },
      "p:bob": '{"playerName":"Bob"}',
      consumed: "1f2e3d4c-not-json",
    });
    expect(await store.hgetall("room:v2:AB7K")).toEqual({
      meta: { code: "AB7K" },
      "p:bob": { playerName: "Bob" },
      consumed: "1f2e3d4c-not-json",
    });
  });

  it("sets a TTL as its own command", async () => {
    const { getKvStore: freshGetKvStore } = await import("@/lib/kv");
    const store = await freshGetKvStore();

    await store.expire("room:v2:AB7K", 1800);
    expect(redisMock.expire).toHaveBeenCalledWith("room:v2:AB7K", 1800);
  });
});

/**
 * The writer and the reader of a day-bucketed counter always live in different
 * modules, so the exact output string is the contract between them. A change
 * here does not break a build or throw — it silently addresses a different key
 * and every counter reads zero from then on. Hence pinning the literal.
 */
describe("dayBucket", () => {
  it("is the UTC calendar date, exactly YYYY-MM-DD", () => {
    expect(dayBucket(new Date("2026-08-09T12:34:56.789Z"))).toBe("2026-08-09");
  });

  it("splits on the UTC midnight boundary, not a local one", () => {
    expect(dayBucket(new Date("2026-08-09T23:59:59.999Z"))).toBe("2026-08-09");
    expect(dayBucket(new Date("2026-08-10T00:00:00.000Z"))).toBe("2026-08-10");
  });

  it("ignores the host timezone, so a lambda and a laptop agree", () => {
    // 2026-08-09T22:00Z is already the 10th in UTC+10 and still the 9th in UTC.
    // Whichever zone the process happens to run in, the bucket is the UTC one.
    const instant = new Date("2026-08-09T22:00:00.000Z");
    expect(dayBucket(instant)).toBe("2026-08-09");
    expect(dayBucket(instant)).toBe(instant.toISOString().slice(0, 10));
  });

  it("defaults to now, so callers do not each reach for a clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-02T03:04:05.000Z"));
    expect(dayBucket()).toBe("2027-01-02");
    vi.useRealTimers();
  });
});
