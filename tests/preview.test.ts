// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/preview/route";

/**
 * The point of every test here is upstream call *count*, not just the returned
 * URL. A cache that returns the right answer while still hammering iTunes
 * fixes nothing — the whole reason this cache exists is that shared serverless
 * egress IPs get throttled, and throttling surfaces as "this song has no
 * audio". So each test asserts on `upstreamCalls()`.
 */

const kv = vi.hoisted(() => {
  const mem = new Map<string, { value: unknown; expiresAt: number }>();
  const writes: Array<{ key: string; value: unknown; ttlSeconds: number }> = [];
  const flags = { failReads: false, failWrites: false };
  return { mem, writes, flags };
});

vi.mock("@/lib/kv", () => ({
  getKvStore: async () => ({
    async get(key: string) {
      if (kv.flags.failReads) throw new Error("kv unavailable");
      const entry = kv.mem.get(key);
      if (!entry || Date.now() > entry.expiresAt) return null;
      return entry.value;
    },
    async set(key: string, value: unknown, ttlSeconds: number) {
      if (kv.flags.failWrites) throw new Error("kv unavailable");
      kv.writes.push({ key, value, ttlSeconds });
      kv.mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key: string) {
      kv.mem.delete(key);
    },
    // Rate limiting shares this store; keep incr working even when the
    // cache paths are told to fail, so a KV-outage test doesn't accidentally
    // become a rate-limit test.
    async incr(key: string, ttlSeconds: number) {
      const entry = kv.mem.get(key);
      const now = Date.now();
      if (!entry || now > entry.expiresAt) {
        kv.mem.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
        return 1;
      }
      const next = (entry.value as number) + 1;
      kv.mem.set(key, { value: next, expiresAt: entry.expiresAt });
      return next;
    },
  }),
}));

const ITUNES_HIT = {
  results: [{ previewUrl: "https://itunes.example/preview.m4a", trackName: "Song", artistName: "Artist" }],
};
const ITUNES_EMPTY = { results: [] };
const DEEZER_HIT = { data: [{ preview: "https://deezer.example/preview.mp3" }] };
const DEEZER_EMPTY = { data: [] };

interface UpstreamBehaviour {
  itunes?: unknown;
  deezer?: unknown;
  /** Make every upstream call reject, simulating a network failure. */
  throwOnFetch?: boolean;
}

function installFetchMock(behaviour: UpstreamBehaviour = {}) {
  const { itunes = ITUNES_EMPTY, deezer = DEEZER_EMPTY, throwOnFetch = false } = behaviour;
  let calls = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      calls++;
      if (throwOnFetch) throw new Error("network down");
      const href = typeof url === "string" ? url : url.toString();
      const body = href.includes("itunes.apple.com") ? itunes : deezer;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async (): Promise<unknown> => body,
      };
    })
  );

  return { upstreamCalls: () => calls };
}

function request(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://127.0.0.1:8000/api/preview?${qs}`);
}

async function previewUrlFrom(res: Response): Promise<string | null> {
  const body = (await res.json()) as { previewUrl?: string | null };
  return body.previewUrl ?? null;
}

beforeEach(() => {
  kv.mem.clear();
  kv.writes.length = 0;
  kv.flags.failReads = false;
  kv.flags.failWrites = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preview lookup", () => {
  it("resolves from iTunes on a cold cache", async () => {
    const probe = installFetchMock({ itunes: ITUNES_HIT });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBe(1);
  });

  it("falls back to Deezer when iTunes has nothing", async () => {
    const probe = installFetchMock({ itunes: ITUNES_EMPTY, deezer: DEEZER_HIT });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp2" }));

    expect(await previewUrlFrom(res)).toBe("https://deezer.example/preview.mp3");
    // Both iTunes queries exhausted, then the first Deezer query hits.
    expect(probe.upstreamCalls()).toBe(3);
  });

  it("returns null when neither source has a preview", async () => {
    const probe = installFetchMock();

    const res = await GET(request({ track: "Nothing", artist: "Nobody", id: "sp3" }));

    expect(await previewUrlFrom(res)).toBeNull();
    // The full fan-out this cache exists to prevent: 2 iTunes + 3 Deezer.
    expect(probe.upstreamCalls()).toBe(5);
  });

  it("survives upstream network failures instead of 500ing", async () => {
    installFetchMock({ throwOnFetch: true });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp4" }));

    expect(res.status).toBe(200);
    expect(await previewUrlFrom(res)).toBeNull();
  });

  it("skips upstream entirely when no track name is supplied", async () => {
    const probe = installFetchMock({ itunes: ITUNES_HIT });

    const res = await GET(request({ artist: "Artist" }));

    expect(await previewUrlFrom(res)).toBeNull();
    expect(probe.upstreamCalls()).toBe(0);
  });
});

describe("preview cache", () => {
  it("serves a repeat hit with zero upstream calls", async () => {
    const probe = installFetchMock({ itunes: ITUNES_HIT });

    await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));
    const callsAfterFirst = probe.upstreamCalls();
    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBe(callsAfterFirst);
  });

  it("caches misses too, so a track with no preview stops costing 5 calls", async () => {
    // The single most important behaviour in this file. Tracks that genuinely
    // have no preview anywhere are the ones queried most repeatedly; without a
    // negative entry each replay burns the full upstream fan-out forever.
    const probe = installFetchMock();

    await GET(request({ track: "Nothing", artist: "Nobody", id: "sp3" }));
    expect(probe.upstreamCalls()).toBe(5);

    const res = await GET(request({ track: "Nothing", artist: "Nobody", id: "sp3" }));

    expect(await previewUrlFrom(res)).toBeNull();
    expect(probe.upstreamCalls()).toBe(5);
  });

  it("holds hits far longer than misses", async () => {
    installFetchMock({ itunes: ITUNES_HIT });
    await GET(request({ track: "Song", artist: "Artist", id: "hit" }));

    vi.unstubAllGlobals();
    installFetchMock();
    await GET(request({ track: "Nothing", artist: "Nobody", id: "miss" }));

    const hitWrite = kv.writes.find((w) => w.key === "preview:id:hit");
    const missWrite = kv.writes.find((w) => w.key === "preview:id:miss");

    expect(hitWrite?.ttlSeconds).toBe(30 * 24 * 60 * 60);
    // Shorter, so a track that later gains a preview isn't written off forever.
    expect(missWrite?.ttlSeconds).toBe(7 * 24 * 60 * 60);
  });

  it("keys on track id, so the same name under a different id is a separate entry", async () => {
    const probe = installFetchMock({ itunes: ITUNES_HIT });

    await GET(request({ track: "Song", artist: "Artist", id: "sp-a" }));
    const afterFirst = probe.upstreamCalls();
    await GET(request({ track: "Song", artist: "Artist", id: "sp-b" }));

    expect(probe.upstreamCalls()).toBeGreaterThan(afterFirst);
    expect(kv.writes.map((w) => w.key)).toEqual(["preview:id:sp-a", "preview:id:sp-b"]);
  });

  it("still caches when the caller sends no id, keyed on a normalised query", async () => {
    const probe = installFetchMock({ itunes: ITUNES_HIT });

    await GET(request({ track: "  Song  ", artist: "Artist" }));
    const afterFirst = probe.upstreamCalls();
    // Different whitespace and casing must land on the same key.
    const res = await GET(request({ track: "SONG", artist: "artist" }));

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBe(afterFirst);
    expect(kv.writes).toHaveLength(1);
    expect(kv.writes[0].key).toBe("preview:q:song|artist");
  });
});

describe("preview cache failure modes", () => {
  it("degrades to upstream when the cache read throws", async () => {
    kv.flags.failReads = true;
    const probe = installFetchMock({ itunes: ITUNES_HIT });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(res.status).toBe(200);
    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBeGreaterThan(0);
  });

  it("still answers when the cache write throws", async () => {
    // Critical gap from the eng review: an unhandled write failure would turn
    // a request that already has its answer into a 500 and stall the round.
    kv.flags.failWrites = true;
    installFetchMock({ itunes: ITUNES_HIT });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(res.status).toBe(200);
    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
  });
});

describe("preview rate limiting", () => {
  it("returns 429 once the window is spent, without touching upstream", async () => {
    const probe = installFetchMock({ itunes: ITUNES_HIT });
    // getClientIp falls back to "unknown" when no proxy headers are present.
    kv.mem.set("ratelimit:preview:unknown", {
      value: 100_000,
      expiresAt: Date.now() + 600_000,
    });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(res.status).toBe(429);
    expect(probe.upstreamCalls()).toBe(0);
  });
});
