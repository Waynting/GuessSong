/**
 * lib/lyrics.ts against a stubbed `fetch` and the in-process KV. Pinned to the
 * Map like tests/quiz-routes.test.ts: a lookup writes cache keys and a
 * cooldown, and none of that may land in production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getKvStore } from "@/lib/kv";
import { LRCLIB_USER_AGENT, __resetLyricsForTests, lookupLyricCandidates, lyricQueries } from "@/lib/lyrics";

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
