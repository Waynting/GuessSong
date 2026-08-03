import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getKvStore } from "@/lib/kv";

const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  mget: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  incr: vi.fn(),
  incrby: vi.fn(),
  expire: vi.fn(),
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
});
