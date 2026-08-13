import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { rateLimit, getClientIp, enforceRateLimit } from "@/lib/rate-limit";

// A working in-memory store by default, with a switch that makes `incr` throw
// the way an exhausted Upstash quota does. The store has to keep working for
// the counting tests below, so the failure is a flag rather than a separate
// mock module.
const kv = vi.hoisted(() => {
  const mem = new Map<string, { value: number; expiresAt: number }>();
  return { mem, flags: { failIncr: false } };
});

vi.mock("@/lib/kv", () => ({
  getKvStore: async () => ({
    async incr(key: string, ttlSeconds: number, by = 1) {
      if (kv.flags.failIncr) {
        throw new Error(
          "ERR max requests limit exceeded. Limit: 500000, Usage: 500000"
        );
      }
      const entry = kv.mem.get(key);
      const now = Date.now();
      if (!entry || now > entry.expiresAt) {
        kv.mem.set(key, { value: by, expiresAt: now + ttlSeconds * 1000 });
        return by;
      }
      const next = entry.value + by;
      kv.mem.set(key, { value: next, expiresAt: entry.expiresAt });
      return next;
    },
  }),
}));

afterEach(() => {
  kv.flags.failIncr = false;
  vi.restoreAllMocks();
});

describe("rateLimit", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const id = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const result = await rateLimit(id, 3, 60);
      expect(result.allowed).toBe(true);
    }
    const blocked = await rateLimit(id, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("keeps separate counters per identifier", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    await rateLimit(a, 1, 60);
    const resultA = await rateLimit(a, 1, 60);
    const resultB = await rateLimit(b, 1, 60);
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });
});

/**
 * The regression these pin: `rateLimit` runs at the top of every API route,
 * before the handler's own try/catch, so a KV error used to escape as a bare
 * 500 with an empty body — no `code` for the client to render, which surfaced
 * as "couldn't load the playlist" on playlists that were fine.
 */
describe("rateLimit when the KV store is unavailable", () => {
  it("fails open rather than throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    kv.flags.failIncr = true;

    const result = await rateLimit(`down-${Math.random()}`, 3, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it("keeps allowing past the limit — an outage must not become a block", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    kv.flags.failIncr = true;

    const id = `down-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect((await rateLimit(id, 3, 60)).allowed).toBe(true);
    }
  });

  it("lets enforceRateLimit admit the request, so routes reach their handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    kv.flags.failIncr = true;

    const req = new NextRequest("http://localhost/api/playlist", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    // null means "not limited" — the handler runs and can return its own
    // coded error instead of Next answering with an empty 500.
    expect(
      await enforceRateLimit(req, "playlist:load", 30, 600, "rate_limited_playlist")
    ).toBeNull();
  });

  it("reports the failure at most once a minute instead of once a request", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    kv.flags.failIncr = true;

    // The module throttles on a module-scope timestamp, so an earlier test in
    // this block may already have spent the current window. Assert on the
    // ratio rather than an exact count: 20 failures must not be 20 lines.
    for (let i = 0; i < 20; i++) await rateLimit(`spam-${i}`, 3, 60);
    expect(logged.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const req = new NextRequest("http://localhost/api/room", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    const withRealIp = new NextRequest("http://localhost/api/room", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(withRealIp)).toBe("9.9.9.9");

    const withNeither = new NextRequest("http://localhost/api/room");
    expect(getClientIp(withNeither)).toBe("unknown");
  });
});
