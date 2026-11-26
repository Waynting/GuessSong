/**
 * lib/lyrics.ts against a stubbed `fetch` and the in-process KV. Pinned to the
 * Map like tests/quiz-routes.test.ts: a lookup writes cache keys and a
 * cooldown, and none of that may land in production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getKvStore } from "@/lib/kv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LRCLIB_USER_AGENT,
  LYRIC_BURST_REQUESTS,
  LYRIC_CREATE_WAIT_MS,
  LYRIC_PACE_MS,
  LYRIC_LINE_WAIT_MS,
  __resetLyricsForTests,
  lookupLyricCandidates,
  lyricQueries,
} from "@/lib/lyrics";

vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
});

let seq = 0;
/** A fresh 22-character id per test, so the shared Map's cache never answers for a previous one. */
function id(): string {
  seq += 1;
  return `t${String(seq).padStart(4, "0")}${Date.now().toString(36)}`.padEnd(22, "x").slice(0, 22);
}

const LYRIC = "first line of this song\nthe chorus goes like this\nthe chorus goes like this\nlast line before the end";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(async () => {
  __resetLyricsForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const store = await getKvStore();
  await store.del("lyrics:cooldown");
  await store.del("lyrics:budget");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyricQueries", () => {
  it("asks the stored spelling, then without the qualifier, then folded to Simplified", () => {
    const qs = lyricQueries({ name: "演員 - Live", artists: ["薛之謙"], durationMs: 261000 });
    expect(qs.map((q) => `${q.track}|${q.artist}`)).toEqual([
      "演員 - Live|薛之謙",
      "演員|薛之謙",
      "演员 - Live|薛之谦",
      "演员|薛之谦",
    ]);
    expect(qs.every((q) => q.durationMs === 261000)).toBe(true);
  });

  it("costs one call for a track that needs no fallback", () => {
    expect(lyricQueries({ name: "Hello", artists: ["Adele"], durationMs: 0 })).toEqual([
      { track: "Hello", artist: "Adele", durationMs: undefined },
    ]);
  });
});

describe("lookupLyricCandidates", () => {
  it("identifies itself, sends the duration in seconds, and caches what it found", async () => {
    const t = { id: id(), name: "Song", artists: ["Act"], durationMs: 201400 };
    fetchMock.mockResolvedValueOnce(json({ plainLyrics: LYRIC }));
    const seen: string[] = [];
    const first = await lookupLyricCandidates([t], (s) => seen.push(s));
    expect(first.get(t.id)).toEqual({ status: "found", lines: expect.arrayContaining(["the chorus goes like this"]) });
    expect(first.get(t.id)?.lines[0]).toBe("the chorus goes like this");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("duration=201");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(LRCLIB_USER_AGENT);
    expect(seen).toEqual(["found"]);

    // The second ask is the cache's, and is not counted as a lookup.
    const again = await lookupLyricCandidates([t], (s) => seen.push(s));
    expect(again.get(t.id)?.status).toBe("found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["found"]);
  });

  it("never stores the whole lyric", async () => {
    const t = { id: id(), name: "Song", artists: ["Act"], durationMs: 0 };
    const long = Array.from({ length: 40 }, (_, i) => `this is lyric line ${i} here`).join("\n");
    fetchMock.mockResolvedValueOnce(json({ plainLyrics: long }));
    await lookupLyricCandidates([t]);
    const stored = await (await getKvStore()).get<{ lines: string[] }>(`lyrics:v1:${t.id}`);
    expect(stored?.lines.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(stored)).not.toContain("plainLyrics");
  });

  it("falls through a 404 to the Simplified spelling", async () => {
    const t = { id: id(), name: "演員", artists: ["薛之謙"], durationMs: 0 };
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(json({ plainLyrics: "简单点说话的方式简单点\n递进的情绪请省略" }));
    const out = await lookupLyricCandidates([t]);
    expect(out.get(t.id)?.status).toBe("found");
    expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent("演员"));
  });

  it("calls every spelling's 404 absent, and an instrumental absent", async () => {
    const a = { id: id(), name: "Nothing", artists: ["Act"], durationMs: 0 };
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect((await lookupLyricCandidates([a])).get(a.id)?.status).toBe("absent");

    const b = { id: id(), name: "Interlude", artists: ["Act"], durationMs: 0 };
    fetchMock.mockResolvedValueOnce(json({ instrumental: true, plainLyrics: null }));
    expect((await lookupLyricCandidates([b])).get(b.id)?.status).toBe("absent");
  });

  it("never writes a 5xx, a timeout or a bad body down as absent", async () => {
    for (const answer of [
      () => Promise.resolve(new Response("", { status: 503 })),
      () => Promise.reject(new Error("timeout")),
      () => Promise.resolve(new Response("not json", { status: 200 })),
    ]) {
      const t = { id: id(), name: "Song", artists: ["Act"], durationMs: 0 };
      fetchMock.mockImplementationOnce(answer);
      expect((await lookupLyricCandidates([t])).get(t.id)?.status).toBe("unavailable");
    }
  });

  it("parks every lookup on a 429 until Retry-After", async () => {
    const a = { id: id(), name: "One", artists: ["Act"], durationMs: 0 };
    const b = { id: id(), name: "Two", artists: ["Act"], durationMs: 0 };
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "120" } }));
    expect((await lookupLyricCandidates([a])).get(a.id)?.status).toBe("unavailable");
    expect((await lookupLyricCandidates([b])).get(b.id)?.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parks for what the header says — one second is one second, never the old thirty", async () => {
    // LRCLIB answers a creation's burst with `Retry-After: 1`. Clamped up to
    // 30s, that wrote off the rest of the creation: 39% of lookups in the
    // week to 2026-11-26 were "could not ask".
    const a = { id: id(), name: "One", artists: ["Act"], durationMs: 0 };
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }));
    const before = Date.now();
    expect((await lookupLyricCandidates([a])).get(a.id)?.status).toBe("unavailable");
    const until = await (await getKvStore()).get<number>("lyrics:cooldown");
    expect(until).toBeGreaterThan(before);
    expect((until as number) - before).toBeLessThanOrEqual(1500);
  });

  it("waits out a short Retry-After and asks again when the call has the patience", async () => {
    const tracks = [1, 2, 3].map((n) => ({ id: id(), name: `Song ${n}`, artists: ["Act"], durationMs: 0 }));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      // The second request of the burst is refused, once.
      return Promise.resolve(
        calls === 2
          ? new Response("", { status: 429, headers: { "retry-after": "1" } })
          : json({ plainLyrics: LYRIC })
      );
    });
    const seen: string[] = [];
    const out = await lookupLyricCandidates(tracks, (s) => seen.push(s), { waitBudgetMs: 5000 });
    expect(tracks.map((t) => out.get(t.id)?.status)).toEqual(["found", "found", "found"]);
    // One lookup per track is reported, the retried one included once.
    expect(seen).toEqual(["found", "found", "found"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not wait past its budget: a long Retry-After is still an answer", async () => {
    const a = { id: id(), name: "One", artists: ["Act"], durationMs: 0 };
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "120" } }));
    const started = Date.now();
    const out = await lookupLyricCandidates([a], undefined, { waitBudgetMs: 5000 });
    expect(out.get(a.id)?.status).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a default quiz's lookups go at once and spaces the ones after", async () => {
    // Twenty lookups is the ten-question default; a burst that size is under
    // what LRCLIB refuses. Past it, each request starts LYRIC_PACE_MS after
    // the one before, whatever the worker count.
    const tracks = Array.from({ length: LYRIC_BURST_REQUESTS + 3 }, (_, n) => ({
      id: id(),
      name: `Song ${n}`,
      artists: ["Act"],
      durationMs: 0,
    }));
    const at: number[] = [];
    fetchMock.mockImplementation(() => {
      at.push(Date.now());
      return Promise.resolve(json({ plainLyrics: LYRIC }));
    });
    const out = await lookupLyricCandidates(tracks, undefined, { waitBudgetMs: 5000 });
    expect([...out.values()].every((r) => r.status === "found")).toBe(true);
    expect(at).toHaveLength(tracks.length);
    const burst = at[LYRIC_BURST_REQUESTS - 1] - at[0];
    expect(burst).toBeLessThan(LYRIC_PACE_MS);
    // Three paced requests: the last starts at least two gaps after the burst's end.
    const tail = at[at.length - 1] - at[LYRIC_BURST_REQUESTS];
    expect(tail).toBeGreaterThanOrEqual(2 * LYRIC_PACE_MS - 30);
  });

  it("does not send a paced request that would start past the deadline", async () => {
    // What keeps a creation inside `maxDuration`: four spellings a track,
    // paced without a deadline, is over a minute of requests.
    const tracks = Array.from({ length: LYRIC_BURST_REQUESTS + 4 }, (_, n) => ({
      id: id(),
      name: `Song ${n}`,
      artists: ["Act"],
      durationMs: 0,
    }));
    fetchMock.mockImplementation(() => Promise.resolve(json({ plainLyrics: LYRIC })));
    // Room for the burst and one paced gap, not for four.
    const out = await lookupLyricCandidates(tracks, undefined, { waitBudgetMs: LYRIC_PACE_MS + 100 });
    const statuses = tracks.map((t) => out.get(t.id)?.status);
    expect(statuses.filter((s) => s === "found").length).toBeGreaterThanOrEqual(LYRIC_BURST_REQUESTS + 1);
    expect(statuses.filter((s) => s === "unavailable").length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeLessThan(tracks.length);
  });

  it("neither paces nor waits with no patience — the old behaviour, for a caller that passes none", async () => {
    const tracks = Array.from({ length: LYRIC_BURST_REQUESTS + 3 }, (_, n) => ({
      id: id(),
      name: `Song ${n}`,
      artists: ["Act"],
      durationMs: 0,
    }));
    fetchMock.mockImplementation(() => Promise.resolve(json({ plainLyrics: LYRIC })));
    const started = Date.now();
    const out = await lookupLyricCandidates(tracks);
    expect([...out.values()].every((r) => r.status === "found")).toBe(true);
    expect(Date.now() - started).toBeLessThan(LYRIC_PACE_MS);
  });

  it("hands both callers a wait budget, the creation the longer one", () => {
    const quizRoute = readFileSync(join(process.cwd(), "app/api/quiz/route.ts"), "utf8");
    const lineRoute = readFileSync(join(process.cwd(), "app/api/lyric/route.ts"), "utf8");
    expect(quizRoute).toMatch(/waitBudgetMs: LYRIC_CREATE_WAIT_MS/);
    expect(lineRoute).toMatch(/waitBudgetMs: LYRIC_LINE_WAIT_MS/);
    expect(LYRIC_CREATE_WAIT_MS).toBeGreaterThan(LYRIC_LINE_WAIT_MS);
    // The creation's ceiling is stated, and leaves room for the wait.
    const ceiling = Number(quizRoute.match(/export const maxDuration = (\d+);/)?.[1]);
    expect(ceiling * 1000).toBeGreaterThanOrEqual(LYRIC_CREATE_WAIT_MS + 10_000);
    expect(LYRIC_LINE_WAIT_MS).toBeGreaterThanOrEqual(1000 + 150);
  });

  it("stops asking past the per-minute budget", async () => {
    vi.stubEnv("LYRICS_MAX_LOOKUPS_PER_MINUTE", "2");
    try {
      const tracks = [1, 2, 3].map((n) => ({ id: id(), name: `Song ${n}`, artists: ["Act"], durationMs: 0 }));
      fetchMock.mockImplementation(() => Promise.resolve(json({ plainLyrics: LYRIC })));
      const out = await lookupLyricCandidates(tracks);
      const statuses = tracks.map((t) => out.get(t.id)?.status);
      expect(statuses.filter((s) => s === "found")).toHaveLength(2);
      expect(statuses.filter((s) => s === "unavailable")).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gives every track an entry, and caches nothing for an id that is not Spotify's shape", async () => {
    const t = { id: "not-a-spotify-id", name: "Song", artists: ["Act"], durationMs: 0 };
    fetchMock.mockImplementation(() => Promise.resolve(json({ plainLyrics: LYRIC })));
    expect((await lookupLyricCandidates([t])).get(t.id)?.status).toBe("found");
    await lookupLyricCandidates([t]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
