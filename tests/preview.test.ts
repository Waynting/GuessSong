// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/preview/route";
import { POST } from "@/app/api/preview/batch/route";
import type { PreviewResult, PreviewStatus } from "@/types/preview";

/**
 * Two things every test here is really about.
 *
 * Upstream call *count*, first: a cache that returns the right answer while
 * still hammering iTunes fixes nothing — the reason this cache exists is that
 * shared serverless egress IPs get throttled, and throttling surfaces as "this
 * song has no audio".
 *
 * And the difference between `absent` and `unavailable`, second. The route used
 * to write every failure down as `previewUrl: null` and cache it for a week, so
 * one throttled minute at peak marked a slice of the catalogue silent for seven
 * days. Any test below that asserts a status is guarding that distinction.
 */

const kv = vi.hoisted(() => {
  const mem = new Map<string, { value: unknown; expiresAt: number }>();
  const writes: Array<{ key: string; value: unknown; ttlSeconds: number }> = [];
  const flags = { failReads: false, failWrites: false };
  const counts = { mget: 0 };
  return { mem, writes, flags, counts };
});

vi.mock("@/lib/kv", () => {
  const read = (key: string) => {
    if (kv.flags.failReads) throw new Error("kv unavailable");
    const entry = kv.mem.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.value;
  };
  return {
    getKvStore: async () => ({
      async get(key: string) {
        return read(key);
      },
      async mget(keys: string[]) {
        kv.counts.mget++;
        return keys.map(read);
      },
      async set(key: string, value: unknown, ttlSeconds: number) {
        if (kv.flags.failWrites) throw new Error("kv unavailable");
        kv.writes.push({ key, value, ttlSeconds });
        kv.mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      },
      async del(key: string) {
        kv.mem.delete(key);
      },
      // Rate limiting, the global budget and the stats counters all share this
      // store; keep incr working even when the cache paths are told to fail, so
      // a KV-outage test doesn't accidentally become a rate-limit test.
      async incr(key: string, ttlSeconds: number, by = 1) {
        const entry = kv.mem.get(key);
        const now = Date.now();
        if (!entry || now > entry.expiresAt) {
          kv.mem.set(key, { value: by, expiresAt: now + ttlSeconds * 1000 });
          return by;
        }
        const next = (entry.value as number) + by;
        kv.mem.set(key, { value: next, expiresAt: entry.expiresAt });
        return next;
      },
    }),
  };
});

const FOUND_TTL = 365 * 24 * 60 * 60;
const ABSENT_TTL = 7 * 24 * 60 * 60;
const UNAVAILABLE_TTL = 90;

const ITUNES_HIT = {
  results: [
    {
      previewUrl: "https://itunes.example/preview.m4a",
      trackId: 4242,
      trackName: "Song",
      artistName: "Artist",
    },
  ],
};
const ITUNES_REFRESHED = {
  results: [
    {
      previewUrl: "https://itunes.example/fresh.m4a",
      trackId: 4242,
      trackName: "Song",
      artistName: "Artist",
    },
  ],
};
const ITUNES_EMPTY = { results: [] };
const DEEZER_HIT = { data: [{ preview: "https://deezer.example/preview.mp3", id: 77 }] };
const DEEZER_EMPTY = { data: [] };
/** Deezer reports its quota limit in the body of a 200, not as a status. */
const DEEZER_QUOTA = { error: { type: "Exception", message: "Quota limit exceeded", code: 4 } };

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: boolean;
}

interface UpstreamBehaviour {
  itunes?: Reply;
  /** Defaults to `itunes` — the refresh path hits a different iTunes endpoint. */
  lookup?: Reply;
  deezer?: Reply;
  throwOnFetch?: boolean;
}

function installFetchMock(behaviour: UpstreamBehaviour = {}) {
  const calls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      calls.push(href);
      if (behaviour.throwOnFetch) throw new Error("network down");

      const reply: Reply = href.includes("itunes.apple.com/lookup")
        ? behaviour.lookup ?? behaviour.itunes ?? { body: ITUNES_EMPTY }
        : href.includes("itunes.apple.com")
          ? behaviour.itunes ?? { body: ITUNES_EMPTY }
          : behaviour.deezer ?? { body: DEEZER_EMPTY };

      if (reply.throws) throw new Error("network down");
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        headers: new Headers(reply.headers ?? {}),
        json: async (): Promise<unknown> => reply.body,
      };
    })
  );

  return {
    upstreamCalls: () => calls.length,
    itunesCalls: () => calls.filter((c) => c.includes("itunes.apple.com")).length,
    deezerCalls: () => calls.filter((c) => c.includes("deezer")).length,
    calls: () => calls,
  };
}

function request(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://127.0.0.1:8000/api/preview?${qs}`);
}

function batchRequest(tracks: unknown): NextRequest {
  return new NextRequest("http://127.0.0.1:8000/api/preview/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks }),
  });
}

async function resultOf(res: Response): Promise<PreviewResult> {
  return (await res.json()) as PreviewResult;
}

async function previewUrlFrom(res: Response): Promise<string | null> {
  return (await resultOf(res)).previewUrl ?? null;
}

async function statusOf(res: Response): Promise<PreviewStatus> {
  return (await resultOf(res)).status;
}

function writeFor(key: string) {
  return kv.writes.find((w) => w.key === key);
}

beforeEach(() => {
  kv.mem.clear();
  kv.writes.length = 0;
  kv.flags.failReads = false;
  kv.flags.failWrites = false;
  kv.counts.mget = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("preview lookup", () => {
  it("resolves from iTunes on a cold cache", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(await resultOf(res)).toEqual({
      previewUrl: "https://itunes.example/preview.m4a",
      status: "found",
    });
    expect(probe.upstreamCalls()).toBe(1);
  });

  it("falls back to Deezer when iTunes has nothing", async () => {
    const probe = installFetchMock({ deezer: { body: DEEZER_HIT } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp2" }));

    expect(await previewUrlFrom(res)).toBe("https://deezer.example/preview.mp3");
    // Both iTunes queries exhausted, then the first Deezer query hits.
    expect(probe.upstreamCalls()).toBe(3);
  });

  it("reports absent when both sources answer and neither has a preview", async () => {
    const probe = installFetchMock();

    const res = await GET(request({ track: "Nothing", artist: "Nobody", id: "sp3" }));

    expect(await resultOf(res)).toEqual({ previewUrl: null, status: "absent" });
    // The full fan-out this cache exists to prevent: 2 iTunes + 3 Deezer.
    expect(probe.upstreamCalls()).toBe(5);
  });

  it("skips upstream entirely when no track name is supplied", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    const res = await GET(request({ artist: "Artist" }));

    expect(await previewUrlFrom(res)).toBeNull();
    expect(probe.upstreamCalls()).toBe(0);
  });
});

/**
 * The regression this module was extracted to fix. Each case is a way of being
 * refused that the old route recorded as a fact about the recording.
 */
describe("a refusal is never mistaken for a missing song", () => {
  it("does not cache a throttled iTunes as 'this song has no preview'", async () => {
    // 403, not 429 — that is how iTunes says no. Reading only 429 leaves the
    // refusal to fall through as an empty result set.
    const probe = installFetchMock({ itunes: { status: 403 }, deezer: { body: DEEZER_EMPTY } });

    const first = await GET(request({ track: "Song", artist: "Artist", id: "hot" }));
    expect(await statusOf(first)).toBe("unavailable");

    const entry = writeFor("preview:id:hot");
    expect(entry?.value).toMatchObject({ previewUrl: null, confirmed: false });
    // Ninety seconds, not seven days. This is the whole bug in one number.
    expect(entry?.ttlSeconds).toBe(UNAVAILABLE_TTL);
  });

  it("re-asks once the short-lived refusal has expired, and then finds the song", async () => {
    vi.useFakeTimers();
    try {
      installFetchMock({ itunes: { status: 403 } });
      await GET(request({ track: "Song", artist: "Artist", id: "hot" }));

      vi.advanceTimersByTime((UNAVAILABLE_TTL + 1) * 1000);
      vi.unstubAllGlobals();
      // Past the cooldown too, so iTunes is asked again rather than skipped.
      const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

      const res = await GET(request({ track: "Song", artist: "Artist", id: "hot" }));
      expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
      expect(probe.itunesCalls()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a dropped connection as unavailable, not as an answer", async () => {
    installFetchMock({ throwOnFetch: true });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp4" }));

    expect(res.status).toBe(200);
    expect(await statusOf(res)).toBe("unavailable");
    expect(writeFor("preview:id:sp4")?.ttlSeconds).toBe(UNAVAILABLE_TTL);
  });

  it("reads Deezer's quota error out of the body of a 200", async () => {
    // Deezer answers a spent quota with HTTP 200 and an `error` object, so a
    // status-only check reads "quota exceeded" as "no such song".
    installFetchMock({ deezer: { body: DEEZER_QUOTA } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "dz" }));

    expect(await statusOf(res)).toBe("unavailable");
  });

  it("treats a 5xx as unavailable rather than as an empty catalogue", async () => {
    installFetchMock({ itunes: { status: 503 }, deezer: { status: 500 } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "down" }));

    expect(await statusOf(res)).toBe("unavailable");
  });

  it("still says absent when a source answers cleanly with an empty result set", async () => {
    // The other half of the contract: this one *is* evidence, and caching it
    // for a week is the point of caching misses at all.
    installFetchMock();

    const res = await GET(request({ track: "Nothing", artist: "Nobody", id: "gone" }));

    expect(await statusOf(res)).toBe("absent");
    expect(writeFor("preview:id:gone")?.ttlSeconds).toBe(ABSENT_TTL);
  });

  it("stops asking a source that just refused, instead of spending a second call", async () => {
    const probe = installFetchMock({ itunes: { status: 429 }, deezer: { body: DEEZER_HIT } });

    await GET(request({ track: "Song", artist: "Artist", id: "one-shot" }));

    // One iTunes query, not two: a second against a host that just said no
    // buys another no.
    expect(probe.itunesCalls()).toBe(1);
  });
});

describe("per-source cooldown", () => {
  it("parks iTunes site-wide after it throttles us, and asks Deezer alone", async () => {
    installFetchMock({ itunes: { status: 403 }, deezer: { body: DEEZER_EMPTY } });
    await GET(request({ track: "Song", artist: "Artist", id: "a" }));

    vi.unstubAllGlobals();
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT }, deezer: { body: DEEZER_HIT } });
    const res = await GET(request({ track: "Song", artist: "Artist", id: "b" }));

    // iTunes is skipped entirely — the saving is the call we never make.
    expect(probe.itunesCalls()).toBe(0);
    expect(await previewUrlFrom(res)).toBe("https://deezer.example/preview.mp3");
  });

  it("honours Retry-After, clamped to a sane floor", async () => {
    installFetchMock({ itunes: { status: 429, headers: { "retry-after": "600" } } });
    await GET(request({ track: "Song", artist: "Artist", id: "a" }));

    expect(writeFor("preview:cooldown:itunes")?.ttlSeconds).toBe(600);
  });

  it("does not park a source over a dropped connection", async () => {
    // One flaky socket is not a rate limit, and parking iTunes for everyone
    // over it would turn a blip into a site-wide outage of the better source.
    installFetchMock({ throwOnFetch: true });
    await GET(request({ track: "Song", artist: "Artist", id: "a" }));

    expect(writeFor("preview:cooldown:itunes")).toBeUndefined();
    expect(writeFor("preview:cooldown:deezer")).toBeUndefined();
  });
});

describe("the global lookup budget", () => {
  it("refuses a cold lookup without touching upstream once the minute is spent", async () => {
    vi.stubEnv("PREVIEW_MAX_LOOKUPS_PER_MINUTE", "2");
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    await GET(request({ track: "A", artist: "Artist", id: "1" }));
    await GET(request({ track: "B", artist: "Artist", id: "2" }));
    const spent = probe.upstreamCalls();

    const res = await GET(request({ track: "C", artist: "Artist", id: "3" }));

    expect(await statusOf(res)).toBe("unavailable");
    expect(probe.upstreamCalls()).toBe(spent);
    // Not cached: the budget claim is already cheap and self-limiting, and a
    // marker per track would spend a KV write during the exact spike we are
    // trying to ride out.
    expect(writeFor("preview:id:3")).toBeUndefined();
  });

  it("still serves cached tracks while the budget is spent", async () => {
    vi.stubEnv("PREVIEW_MAX_LOOKUPS_PER_MINUTE", "1");
    installFetchMock({ itunes: { body: ITUNES_HIT } });

    await GET(request({ track: "A", artist: "Artist", id: "1" }));
    const res = await GET(request({ track: "A", artist: "Artist", id: "1" }));

    // A party mid-game is unaffected by someone else's spike.
    expect(await statusOf(res)).toBe("found");
  });

  it("fails open when KV is unreachable", async () => {
    // Losing the safety net has to mean "back to how it was", not "nobody
    // hears any music".
    kv.flags.failReads = true;
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(await statusOf(res)).toBe("found");
    expect(probe.upstreamCalls()).toBeGreaterThan(0);
  });
});

describe("preview cache", () => {
  it("serves a repeat hit with zero upstream calls", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));
    const callsAfterFirst = probe.upstreamCalls();
    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBe(callsAfterFirst);
  });

  it("caches confirmed misses too, so a track with no preview stops costing 5 calls", async () => {
    // Tracks that genuinely have no preview anywhere are the ones queried most
    // repeatedly; without a negative entry each replay burns the full fan-out.
    const probe = installFetchMock();

    await GET(request({ track: "Nothing", artist: "Nobody", id: "sp3" }));
    expect(probe.upstreamCalls()).toBe(5);

    const res = await GET(request({ track: "Nothing", artist: "Nobody", id: "sp3" }));

    expect(await statusOf(res)).toBe("absent");
    expect(probe.upstreamCalls()).toBe(5);
  });

  it("holds found URLs far longer than misses, and refusals barely at all", async () => {
    installFetchMock({ itunes: { body: ITUNES_HIT } });
    await GET(request({ track: "Song", artist: "Artist", id: "hit" }));

    vi.unstubAllGlobals();
    installFetchMock();
    await GET(request({ track: "Nothing", artist: "Nobody", id: "miss" }));

    // A recording does not change. URL rot is repaired by refresh, not waited
    // out — which is what lets this be a year rather than a month.
    expect(writeFor("preview:id:hit")?.ttlSeconds).toBe(FOUND_TTL);
    expect(writeFor("preview:id:miss")?.ttlSeconds).toBe(ABSENT_TTL);
  });

  it("stores the iTunes track id, so a rotted URL can be repaired cheaply", async () => {
    installFetchMock({ itunes: { body: ITUNES_HIT } });

    await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(writeFor("preview:id:sp1")?.value).toMatchObject({
      source: "itunes",
      itunesTrackId: 4242,
    });
  });

  it("keys on track id, so the same name under a different id is a separate entry", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    await GET(request({ track: "Song", artist: "Artist", id: "sp-a" }));
    const afterFirst = probe.upstreamCalls();
    await GET(request({ track: "Song", artist: "Artist", id: "sp-b" }));

    expect(probe.upstreamCalls()).toBeGreaterThan(afterFirst);
    expect(kv.writes.map((w) => w.key)).toEqual(["preview:id:sp-a", "preview:id:sp-b"]);
  });

  it("still caches when the caller sends no id, keyed on a normalised query", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    await GET(request({ track: "  Song  ", artist: "Artist" }));
    const afterFirst = probe.upstreamCalls();
    // Different whitespace and casing must land on the same key.
    const res = await GET(request({ track: "SONG", artist: "artist" }));

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBe(afterFirst);
    expect(kv.writes).toHaveLength(1);
    expect(kv.writes[0].key).toBe("preview:q:song|artist");
  });

  it("reads entries written before this shape existed", async () => {
    // Production is full of bare `{previewUrl}` records and the key was left
    // unversioned on purpose: bumping it would cold-start every entry at once,
    // which is precisely the upstream burst this module exists to prevent.
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });
    kv.mem.set("preview:id:old-hit", {
      value: { previewUrl: "https://legacy.example/clip.m4a" },
      expiresAt: Date.now() + 60_000,
    });
    kv.mem.set("preview:id:old-miss", {
      value: { previewUrl: null },
      expiresAt: Date.now() + 60_000,
    });

    const hit = await GET(request({ track: "Song", artist: "Artist", id: "old-hit" }));
    const miss = await GET(request({ track: "Song", artist: "Artist", id: "old-miss" }));

    expect(await resultOf(hit)).toEqual({
      previewUrl: "https://legacy.example/clip.m4a",
      status: "found",
    });
    // A legacy null has no `confirmed` flag and is read as settled. Some of
    // them are poisoned by the old bug, but re-resolving every one of them at
    // once is the same stampede that poisoned them — they age out within a week.
    expect(await statusOf(miss)).toBe("absent");
    expect(probe.upstreamCalls()).toBe(0);
  });
});

describe("refresh", () => {
  it("repairs a rotted URL with one lookup instead of a full search", async () => {
    installFetchMock({ itunes: { body: ITUNES_HIT } });
    await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    vi.unstubAllGlobals();
    const probe = installFetchMock({ lookup: { body: ITUNES_REFRESHED } });
    const res = await GET(
      request({ track: "Song", artist: "Artist", id: "sp1", refresh: "1" })
    );

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/fresh.m4a");
    expect(probe.upstreamCalls()).toBe(1);
    expect(probe.calls()[0]).toContain("/lookup?id=4242");
  });

  it("falls back to a full search when the stored id no longer resolves", async () => {
    installFetchMock({ itunes: { body: ITUNES_HIT } });
    await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    vi.unstubAllGlobals();
    // The id was retired from the store; a search can still route around it.
    const probe = installFetchMock({
      lookup: { body: ITUNES_EMPTY },
      itunes: { body: ITUNES_REFRESHED },
    });
    const res = await GET(
      request({ track: "Song", artist: "Artist", id: "sp1", refresh: "1" })
    );

    expect(await previewUrlFrom(res)).toBe("https://itunes.example/fresh.m4a");
    expect(probe.upstreamCalls()).toBeGreaterThan(1);
  });

  it("has its own, much tighter rate limit bucket", async () => {
    // It bypasses the cache by design, so it is the one parameter here that
    // can be turned into an upstream amplifier.
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });
    kv.mem.set("ratelimit:preview:refresh:unknown", {
      value: 100_000,
      expiresAt: Date.now() + 600_000,
    });

    const refused = await GET(
      request({ track: "Song", artist: "Artist", id: "sp1", refresh: "1" })
    );
    expect(refused.status).toBe(429);

    // The ordinary read path is untouched by a spent refresh budget.
    const ok = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));
    expect(ok.status).toBe(200);
    expect(probe.upstreamCalls()).toBeGreaterThan(0);
  });
});

describe("preview cache failure modes", () => {
  it("degrades to upstream when the cache read throws", async () => {
    kv.flags.failReads = true;
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(res.status).toBe(200);
    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
    expect(probe.upstreamCalls()).toBeGreaterThan(0);
  });

  it("still answers when the cache write throws", async () => {
    // An unhandled write failure would turn a request that already has its
    // answer into a 500 and stall the round.
    kv.flags.failWrites = true;
    installFetchMock({ itunes: { body: ITUNES_HIT } });

    const res = await GET(request({ track: "Song", artist: "Artist", id: "sp1" }));

    expect(res.status).toBe(200);
    expect(await previewUrlFrom(res)).toBe("https://itunes.example/preview.m4a");
  });
});

describe("preview rate limiting", () => {
  it("returns 429 once the window is spent, without touching upstream", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });
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

describe("batch lookups", () => {
  const track = (n: number) => ({ id: `sp${n}`, name: `Song ${n}`, artist: "Artist" });

  async function previewsFrom(res: Response): Promise<Record<string, PreviewResult>> {
    const body = (await res.json()) as { previews: Record<string, PreviewResult> };
    return body.previews;
  }

  it("reads the whole game with a single mget", async () => {
    // The reason this route exists is the KV bill: one command for fifty
    // tracks rather than fifty. Reading them one at a time still works — it
    // just costs 50x on the one quota this app actually pays for.
    installFetchMock({ itunes: { body: ITUNES_HIT } });

    const res = await POST(batchRequest([track(1), track(2), track(3)]));

    expect(res.status).toBe(200);
    expect(kv.counts.mget).toBe(1);
    expect(Object.keys(await previewsFrom(res))).toEqual(["sp1", "sp2", "sp3"]);
  });

  it("answers a warm cache with no upstream calls at all", async () => {
    installFetchMock({ itunes: { body: ITUNES_HIT } });
    await POST(batchRequest([track(1), track(2)]));

    vi.unstubAllGlobals();
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });
    const res = await POST(batchRequest([track(1), track(2)]));

    expect(probe.upstreamCalls()).toBe(0);
    expect((await previewsFrom(res)).sp1.previewUrl).toBe("https://itunes.example/preview.m4a");
  });

  it("reports each track's own status rather than one verdict for the batch", async () => {
    // A game is a mix: some tracks resolve, some genuinely have no clip. One
    // status for the request would make the second look like the first.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        const hit = href.includes("Song%201");
        return {
          ok: true,
          status: 200,
          statusText: "",
          headers: new Headers(),
          json: async () =>
            href.includes("itunes")
              ? hit
                ? ITUNES_HIT
                : ITUNES_EMPTY
              : DEEZER_EMPTY,
        };
      })
    );

    const previews = await previewsFrom(await POST(batchRequest([track(1), track(2)])));

    expect(previews.sp1.status).toBe("found");
    expect(previews.sp2.status).toBe("absent");
  });

  it("defers the tail of an oversized game instead of eating the global budget", async () => {
    // 25 resolved, the rest handed back as unavailable so the per-track path
    // picks them up lazily — one cold 50-song start must not starve every
    // other party on the site.
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });
    const tracks = Array.from({ length: 30 }, (_, i) => track(i));

    const previews = await previewsFrom(await POST(batchRequest(tracks)));

    expect(probe.upstreamCalls()).toBe(25);
    const deferred = Object.values(previews).filter((p) => p.status === "unavailable");
    expect(deferred).toHaveLength(5);
    // Deferred tracks are not written to KV: nothing refused them, and a
    // marker would suppress the lazy lookup meant to pick them up.
    expect(kv.writes.filter((w) => w.ttlSeconds === UNAVAILABLE_TTL)).toHaveLength(0);
  });

  it("defers everything when the global budget can't cover the batch", async () => {
    vi.stubEnv("PREVIEW_MAX_LOOKUPS_PER_MINUTE", "2");
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });

    const previews = await previewsFrom(await POST(batchRequest([track(1), track(2), track(3)])));

    // All-or-nothing, so a game defers cleanly rather than stopping halfway
    // through its own playlist.
    expect(probe.upstreamCalls()).toBe(0);
    expect(Object.values(previews).every((p) => p.status === "unavailable")).toBe(true);
  });

  it("refuses a malformed or oversized body with a code, not a bare 400", async () => {
    installFetchMock();

    for (const body of [
      [],
      [{ name: "No id" }],
      [{ id: "sp1" }],
      Array.from({ length: 61 }, (_, i) => track(i)),
    ]) {
      const res = await POST(batchRequest(body));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code?: string }).code).toBe("preview_request_invalid");
    }
  });

  it("returns 429 once the window is spent, without touching upstream", async () => {
    const probe = installFetchMock({ itunes: { body: ITUNES_HIT } });
    kv.mem.set("ratelimit:preview:batch:unknown", {
      value: 100_000,
      expiresAt: Date.now() + 600_000,
    });

    const res = await POST(batchRequest([track(1)]));

    expect(res.status).toBe(429);
    expect(probe.upstreamCalls()).toBe(0);
  });
});
