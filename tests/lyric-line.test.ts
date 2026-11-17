/**
 * The guess game's "Read a lyric instead": `GET /api/lyric`, its client
 * helper, the page wiring, the error copy and the counters.
 *
 * The route runs against the real lib/lyrics.ts and the in-process KV, with
 * LRCLIB stubbed at `fetch` — never the network. Pinned to the Map like
 * tests/quiz-routes.test.ts: the route writes counters and cache keys, and
 * this is a test that would *pass* against production and inflate the
 * numbers `npm run stats` prints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { dayBucket, getKvStore } from "@/lib/kv";
import { LOOP_SURFACES } from "@/lib/loop-links";
import { loopStatsKeys, recordLyricLineRound } from "@/lib/loop-stats";
import { __resetLyricsForTests } from "@/lib/lyrics";
import { fetchLyricLine, readLyricForRound } from "@/lib/lyric-client";
import { createRoundToken } from "@/lib/round-token";
import { ERROR_MESSAGES } from "@/lib/error-messages";
import { parsePulse } from "@/lib/pulse";
import { titleKey } from "@/lib/quiz";
import { PREVIEW_FIELD_MAX } from "@/types/preview";
import type { LyricLineResult } from "@/types/lyric-line";
import { GET } from "@/app/api/lyric/route";

vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
});

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const keys = loopStatsKeys(dayBucket(), LOOP_SURFACES);

async function count(key: string): Promise<number> {
  return ((await (await getKvStore()).get<number>(key)) ?? 0) as number;
}

let seq = 0;
/** A fresh Spotify-shaped id per call, so the shared Map's cache never answers for another test. */
function id(): string {
  seq += 1;
  return `L${String(seq).padStart(4, "0")}${Date.now().toString(36)}`.padEnd(22, "x").slice(0, 22);
}

let ipCounter = 0;
function request(params: Record<string, string>, ip = `10.9.0.${(ipCounter += 1)}`): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://127.0.0.1:8000/api/lyric?${qs}`, { headers: { "x-forwarded-for": ip } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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

async function body(res: Response): Promise<LyricLineResult> {
  return (await res.json()) as LyricLineResult;
}

describe("GET /api/lyric", () => {
  it("runs the per-IP limiter before any work, and spends nothing upstream when refused", async () => {
    const ip = "10.9.255.1";
    await (await getKvStore()).set(`ratelimit:lyric:${ip}`, 100_000, 600);
    const res = await GET(request({ track: id(), name: "Hello", artist: "Adele" }, ip));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("rate_limited_lyric");
    expect(fetchMock).not.toHaveBeenCalled();

    // And in the source: the guard is the first await in the handler.
    const src = read("app/api/lyric/route.ts");
    const handler = src.slice(src.indexOf("export async function GET"));
    expect(handler.indexOf("enforceRateLimit(")).toBeGreaterThan(-1);
    expect(handler.indexOf("enforceRateLimit(")).toBeLessThan(handler.indexOf("lookupLyricCandidates("));
    expect(src).toMatch(/const LYRIC_LINE_LIMIT = \d+;/);
    expect(src).toMatch(/const LYRIC_LINE_WINDOW_SECONDS = /);
  });

  it("clamps name and artist by code point before they reach LRCLIB", async () => {
    fetchMock.mockResolvedValue(json({ plainLyrics: "" }, 404));
    // An emoji on the boundary: a UTF-16 slice would leave a lone surrogate
    // and URLSearchParams/encodeURIComponent would mangle or throw on it.
    const long = "😀".repeat(PREVIEW_FIELD_MAX + 50);
    const res = await GET(request({ track: id(), name: long, artist: long }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const asked = new URL(fetchMock.mock.calls[0][0]);
    expect(Array.from(asked.searchParams.get("track_name") ?? "")).toHaveLength(PREVIEW_FIELD_MAX);
    expect(Array.from(asked.searchParams.get("artist_name") ?? "")).toHaveLength(PREVIEW_FIELD_MAX);
    expect(read("app/api/lyric/route.ts")).toMatch(/clampPreviewField\(searchParams\.get\("name"\)/);
    expect(read("app/api/lyric/route.ts")).toMatch(/clampPreviewField\(searchParams\.get\("artist"\)/);
  });

  it("answers a line in the song, never one naming the title — across Simplified and Traditional", async () => {
    fetchMock.mockResolvedValue(
      json({
        plainLyrics: [
          "简单点 说话的方式简单点",
          "该配合你演出的我演员尽力在表演",
          "该配合你演出的我演员尽力在表演",
          "递进的情绪请省略",
          "你又不是个演员",
        ].join("\n"),
      })
    );
    const res = await GET(request({ track: id(), name: "演員", artist: "薛之謙" }));
    const out = await body(res);
    expect(out.status).toBe("found");
    expect(out.line).toBeTruthy();
    expect(out.line).not.toMatch(/演员|演員/);
    expect(titleKey(out.line ?? "")).not.toContain(titleKey("演員"));
  });

  it("re-checks the title on its own request, even against candidates cached under another spelling", async () => {
    const trackId = id();
    // As if the quiz cached these under a title that did not exclude 演員.
    await (await getKvStore()).set(
      `lyrics:v1:${trackId}`,
      { status: "found", lines: ["我演员尽力在表演", "递进的情绪请省略"], resolvedAt: Date.now() },
      600
    );
    const out = await body(await GET(request({ track: trackId, name: "演員", artist: "薛之謙" })));
    expect(out).toEqual({ line: "递进的情绪请省略", status: "found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers absent when every cached line names the title", async () => {
    const trackId = id();
    await (await getKvStore()).set(
      `lyrics:v1:${trackId}`,
      { status: "found", lines: ["我演员尽力在表演"], resolvedAt: Date.now() },
      600
    );
    expect(await body(await GET(request({ track: trackId, name: "演員", artist: "薛之謙" })))).toEqual({
      line: null,
      status: "absent",
    });
  });

  it("tells absent (cached, not asked again) from unavailable (asked again)", async () => {
    const absentId = id();
    fetchMock.mockImplementation(async () => json({ message: "not found" }, 404));
    expect((await body(await GET(request({ track: absentId, name: "Nope", artist: "Nobody" })))).status).toBe("absent");
    const calls = fetchMock.mock.calls.length;
    expect((await body(await GET(request({ track: absentId, name: "Nope", artist: "Nobody" })))).status).toBe("absent");
    expect(fetchMock.mock.calls.length).toBe(calls);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json({}, 503));
    const out = await body(await GET(request({ track: id(), name: "Down", artist: "Server" })));
    expect(out).toEqual({ line: null, status: "unavailable" });
  });

  it("answers a malformed id absent without asking upstream or counting it", async () => {
    const before = await count(keys.lyricLine.absent);
    const out = await body(await GET(request({ track: "not-a-spotify-id", name: "Hello", artist: "Adele" })));
    expect(out).toEqual({ line: null, status: "absent" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await count(keys.lyricLine.absent)).toBe(before);
  });

  it("counts every tap's outcome server-side as lyric_line:<status>", async () => {
    const before = {
      found: await count(keys.lyricLine.found),
      absent: await count(keys.lyricLine.absent),
      unavailable: await count(keys.lyricLine.unavailable),
    };
    fetchMock.mockResolvedValueOnce(json({ plainLyrics: "walking down the empty road\nunder a silver moon tonight" }));
    await GET(request({ track: id(), name: "Moon Song", artist: "Someone" }));
    fetchMock.mockResolvedValue(json({}, 404));
    await GET(request({ track: id(), name: "Missing", artist: "Someone" }));
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json({}, 500));
    await GET(request({ track: id(), name: "Broken", artist: "Someone" }));

    expect(await count(keys.lyricLine.found)).toBe(before.found + 1);
    expect(await count(keys.lyricLine.absent)).toBe(before.absent + 1);
    expect(await count(keys.lyricLine.unavailable)).toBe(before.unavailable + 1);
  });

  it("reuses lib/lyrics.ts and lib/lyric-fragment.ts — no second LRCLIB path, no second key, no full text", () => {
    // Code only: the header comment names the key and the field it never holds.
    const src = read("app/api/lyric/route.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/from "@\/lib\/lyrics"/);
    expect(src).toMatch(/pickLyricLine\(/);
    expect(src).not.toMatch(/lrclib|fetch\(|plainLyrics/i);
    expect(src).not.toMatch(/lyrics:v\d/);
  });
});

describe("lib/lyric-client.ts", () => {
  const track = { id: "abcdefghijklmnopqrstuv", name: "Song", artist: "Artist" };

  it("drops a stale round's answer from the screen, and still caches it by track id", async () => {
    const rounds = createRoundToken();
    const cache = new Map<string, LyricLineResult>();
    const stillThisRound = rounds.begin();
    let release!: (r: LyricLineResult) => void;
    const pending = readLyricForRound(track, stillThisRound, cache, () => new Promise((r) => (release = r)));
    rounds.bump(); // the host pressed Skip Track while the line was on its way
    release({ line: "a line of it", status: "found" });
    expect(await pending).toBeNull();
    expect(cache.get(track.id)).toEqual({ line: "a line of it", status: "found" });

    // Coming back to the track answers from the cache, without asking.
    const fetcher = vi.fn();
    expect(await readLyricForRound(track, rounds.begin(), cache, fetcher)).toEqual({ line: "a line of it", status: "found" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("caches settled answers only — an unavailable is asked again", async () => {
    const cache = new Map<string, LyricLineResult>();
    const rounds = createRoundToken();
    const out = await readLyricForRound(track, rounds.begin(), cache, async () => ({ line: null, status: "unavailable" }));
    expect(out).toEqual({ line: null, status: "unavailable" });
    expect(cache.has(track.id)).toBe(false);
    await readLyricForRound(track, rounds.begin(), cache, async () => ({ line: null, status: "absent" }));
    expect(cache.get(track.id)?.status).toBe("absent");
  });

  it("reads every failure as unavailable, never absent", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "rate_limited_lyric" }, 429));
    expect(await fetchLyricLine(track)).toEqual({ line: null, status: "unavailable" });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await fetchLyricLine(track)).toEqual({ line: null, status: "unavailable" });
    fetchMock.mockResolvedValueOnce(json({ status: "found", line: null }));
    expect(await fetchLyricLine(track)).toEqual({ line: null, status: "absent" });
    fetchMock.mockResolvedValueOnce(json({ status: "found", line: "the line" }));
    expect(await fetchLyricLine(track)).toEqual({ line: "the line", status: "found" });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toMatch(/^\/api\/lyric\?track=abcdefghijklmnopqrstuv&name=Song&artist=Artist/);
  });

  it("imports nothing that reaches the server", () => {
    const src = read("lib/lyric-client.ts");
    expect(src).not.toMatch(/@\/lib\/(kv|lyrics|lyric-fragment|loop-stats)"/);
  });
});

describe("the game page wiring", () => {
  const page = read("app/game/page.tsx");
  const fn = (name: string) => {
    const start = page.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return page.slice(start, page.indexOf("\n  }\n", start));
  };

  it("offers the button in the waiting phase, as the primary when the track has no clip", () => {
    expect(page).toContain("Read a lyric instead");
    expect(page).toMatch(/clipMiss \? \(\s*<>[\s\S]*?\{lyricBlock\(true\)\}[\s\S]*?\{skipControls\(\)\}/);
    expect(fn("lyricBlock")).toMatch(/primary \? "btn-primary" : "btn-ghost compact"/);
  });

  it("takes the round token before the await, through the lib/ helper", () => {
    const body = fn("readLyric");
    const begin = body.indexOf("roundsRef.current.begin()");
    const awaitAt = body.indexOf("await readLyricForRound(");
    expect(begin).toBeGreaterThan(-1);
    expect(awaitAt).toBeGreaterThan(begin);
    expect(body).toContain("stillThisRound");
    expect(page).not.toMatch(/fetch\(`\/api\/lyric/);
    expect(page).not.toMatch(/from "@\/lib\/lyrics"/);
  });

  it("puts the line away with the round, and shows quotes or a coded sentence", () => {
    const retire = page.slice(page.indexOf("const retireRound = useCallback"), page.indexOf("}, [settleFirstClip, stopClip, releaseClip, endBusy]);"));
    expect(retire).toContain("roundsRef.current.bump()");
    expect(retire).toContain("setLyric(null)");
    const block = fn("lyricBlock");
    expect(block).toContain("“{lyric.line}”");
    expect(block).toContain('"lyric_absent"');
    expect(block).toContain('"lyric_unavailable"');
    expect(block).toContain("errorMessage(");
  });

  it("counts a round played from a line once, at its reveal, and adds no answer checking", () => {
    const reveal = fn("reveal");
    expect(reveal).toMatch(/lyric\?\.status === "found" && !lyricRoundCountedRef\.current/);
    expect(reveal).toContain("reportLyricLineRound()");
    expect(page).toContain('setPhase("revealed")');
  });
});

describe("the copy", () => {
  it("has both languages for the lyric codes, and none of them blames the playlist", () => {
    for (const code of ["lyric_absent", "lyric_unavailable", "rate_limited_lyric"] as const) {
      const { en, zh } = ERROR_MESSAGES[code];
      expect(en.trim(), code).not.toBe("");
      expect(zh.trim(), code).not.toBe("");
      expect(zh).not.toBe(en);
      expect(en).not.toMatch(/playlist|public/i);
      expect(zh).not.toMatch(/歌單|公開/);
    }
  });
});

describe("the counters", () => {
  it("accepts the round pulse's one outcome and refuses anything else", () => {
    expect(parsePulse({ kind: "lyric_line_round", outcome: "played" })).toEqual({ kind: "lyric_line_round", outcome: "played" });
    expect(parsePulse({ kind: "lyric_line_round", outcome: "skipped" })).toBeNull();
    expect(parsePulse({ kind: "lyric_line_round" })).toBeNull();
    expect(read("app/api/pulse/route.ts")).toMatch(/case "lyric_line_round":\s*await recordLyricLineRound\(event\.outcome\);/);
  });

  it("writes the round counter under the key the digest reads", async () => {
    const before = await count(keys.lyricLineRound.played);
    await recordLyricLineRound("played");
    await recordLyricLineRound("nope" as never);
    expect(await count(keys.lyricLineRound.played)).toBe(before + 1);
  });

  it("is printed by npm run stats, under prefixes it treats as rendered", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"lyric_line:"');
    expect(rendered).toContain('"lyric_line_round:"');
    expect(script).toContain("Lyric lines (guess game)");
    for (const status of ["found", "absent", "unavailable"]) expect(script).toContain(`get("lyric_line:${status}")`);
    expect(script).toContain('get("lyric_line_round:played")');
  });
});
