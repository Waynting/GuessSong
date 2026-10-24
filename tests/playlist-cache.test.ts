// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as postPlaylist } from "@/app/api/playlist/route";
import * as spotify from "@/lib/spotify";
import {
  loadPlaylist,
  getCacheStats,
  getDailyBudgetStatus,
  getSpotifyServiceStatus,
  __resetInFlightForTests,
} from "@/lib/playlist-cache";
import { isDeterministicPlaylistFailure } from "@/lib/error-messages";
import type { Track } from "@/types";

/**
 * Like tests/preview.test.ts, every assertion here is about upstream call
 * *count*. A cache that returns the right tracks while still paginating
 * Spotify on every request fixes nothing — the failure this exists to prevent
 * is `429 QUOTA_EXCEEDED` against a client id shared by the entire user base,
 * and the only thing that moves that number is not making the call.
 */

const kv = vi.hoisted(() => {
  const mem = new Map<string, { value: unknown; expiresAt: number }>();
  const writes: Array<{ key: string; value: unknown; ttlSeconds: number }> = [];
  const flags = { failReads: false, failWrites: false };
  /**
   * Every read the store is asked for, counted (`kv.writes` already records
   * the other half). Several invariants in
   * lib/playlist-cache.ts and lib/preview-cache.ts are cost claims ("one KV
   * read", "no counter read to compose a log line"), and a cost claim that
   * nothing measures is the kind that regresses in a refactor without a single
   * test going red.
   */
  const counts = { reads: 0 };
  return { mem, writes, flags, counts };
});

vi.mock("@/lib/kv", () => ({
  // `dayBucket` is a pure function over a clock, not a store, so the fake
  // reproduces it rather than stubbing it — a mocked bucket would let the key
  // format drift here without any test noticing.
  dayBucket: (at: Date = new Date()) => at.toISOString().slice(0, 10),
  hourBucket: (at: Date = new Date()) => at.toISOString().slice(0, 13),
  getKvStore: async () => ({
    async get(key: string) {
      kv.counts.reads++;
      if (kv.flags.failReads) throw new Error("kv unavailable");
      const entry = kv.mem.get(key);
      if (!entry || Date.now() > entry.expiresAt) return null;
      return entry.value;
    },
    async mget(keys: string[]) {
      kv.counts.reads++;
      if (kv.flags.failReads) throw new Error("kv unavailable");
      return keys.map((key) => {
        const entry = kv.mem.get(key);
        if (!entry || Date.now() > entry.expiresAt) return null;
        return entry.value;
      });
    },
    async set(key: string, value: unknown, ttlSeconds: number) {
      if (kv.flags.failWrites) throw new Error("kv unavailable");
      kv.writes.push({ key, value, ttlSeconds });
      kv.mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key: string) {
      kv.mem.delete(key);
    },
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

// Only the two network-facing entry points are mocked. parsePlaylistUrl,
// isSpotifyEditorial and SpotifyApiError stay real, because the cache's
// routing decisions are built on them.
vi.mock("@/lib/spotify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spotify")>();
  return { ...actual, getPlaylistWithTracks: vi.fn(), getAlbumWithTracks: vi.fn() };
});

/**
 * Ids are padded to the 22 base62 characters Spotify issues. The classifier
 * (lib/spotify-link.ts) refuses anything else before the cache is read, so a
 * short id here would turn every test below into a test of that refusal.
 */
const playlistId = (seed: string) => seed.padEnd(22, "a");
const urlFor = (seed: string) => `https://open.spotify.com/playlist/${playlistId(seed)}`;

const URL_A = urlFor("a");
const URL_B = urlFor("b");

function makeTrack(id: string): Track {
  return {
    id,
    name: `Song ${id}`,
    artists: ["Artist"],
    durationMs: 200000,
    createdAt: "2026-01-01T00:00:00.000Z",
    rawJson: { huge: "blob" },
  };
}

function upstreamResult(ids: string[], truncated = false) {
  return {
    playlist: { id: "p", name: "My Playlist", tracks: { items: [], total: ids.length } },
    tracks: ids.map(makeTrack),
    truncated,
  };
}

const upstream = () => vi.mocked(spotify.getPlaylistWithTracks);
const upstreamCalls = () => upstream().mock.calls.length;

/** `GET /albums/{id}` as lib/spotify.ts hands it back. */
function albumResult(ids: string[], truncated = false) {
  return {
    album: { id: "x", name: "My Album", images: [], tracks: { items: [], total: ids.length } },
    tracks: ids.map(makeTrack),
    truncated,
  };
}

const albumUpstream = () => vi.mocked(spotify.getAlbumWithTracks);
const albumUpstreamCalls = () => albumUpstream().mock.calls.length;
const albumUrlFor = (seed: string) => `https://open.spotify.com/album/${playlistId(seed)}`;

beforeEach(() => {
  kv.mem.clear();
  kv.writes.length = 0;
  kv.counts.reads = 0;
  kv.flags.failReads = false;
  kv.flags.failWrites = false;
  __resetInFlightForTests();
  upstream().mockReset();
  upstream().mockResolvedValue(upstreamResult(["a", "b"]));
  albumUpstream().mockReset();
  albumUpstream().mockResolvedValue(albumResult(["x1", "x2"]));
});

describe("playlist cache", () => {
  it("returns the playlist and its tracks on a cold load", async () => {
    const result = await loadPlaylist(URL_A);

    expect(result.name).toBe("My Playlist");
    expect(result.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(result.totalTracks).toBe(2);
    expect(result.truncated).toBe(false);
    expect(upstreamCalls()).toBe(1);
  });

  it("serves a repeat load from cache with zero upstream calls", async () => {
    await loadPlaylist(URL_A);
    const second = await loadPlaylist(URL_A);

    expect(second.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    // This is the whole fix: the same playlist used to re-paginate every time.
    expect(upstreamCalls()).toBe(1);
  });

  it("keys the cache by playlist id, so a different playlist still loads", async () => {
    await loadPlaylist(URL_A);
    upstream().mockResolvedValue(upstreamResult(["c"]));
    const other = await loadPlaylist(URL_B);

    expect(other.tracks.map((t) => t.id)).toEqual(["c"]);
    expect(upstreamCalls()).toBe(2);
  });

  it("hits the same cache entry for the URI form of the same playlist", async () => {
    await loadPlaylist(URL_A);
    await loadPlaylist(`spotify:playlist:${playlistId("a")}`);

    expect(upstreamCalls()).toBe(1);
  });

  it("strips rawJson before caching, so entries stay small", async () => {
    const result = await loadPlaylist(URL_A);

    expect(result.tracks[0]).not.toHaveProperty("rawJson");
    const entry = kv.writes[0].value as { tracks: Track[] };
    expect(entry.tracks[0]).not.toHaveProperty("rawJson");
  });

  it("preserves the truncated flag through the cache", async () => {
    upstream().mockResolvedValue(upstreamResult(["a"], true));

    expect((await loadPlaylist(URL_A)).truncated).toBe(true);
    expect((await loadPlaylist(URL_A)).truncated).toBe(true);
    expect(upstreamCalls()).toBe(1);
  });

  it("remembers an empty playlist for the 404's ten minutes, not a day", async () => {
    upstream().mockResolvedValue(upstreamResult([]));

    await loadPlaylist(URL_A);
    await loadPlaylist(URL_A);
    await loadPlaylist(URL_A);

    // `playlist_empty` is deterministic, so a host retrying it must not spend
    // a load and a daily-budget slot each time — but a playlist the host is
    // still filling shouldn't be remembered as empty for long either.
    expect(upstreamCalls()).toBe(1);
    expect(kv.writes.find((w) => w.key.startsWith("playlist:v"))?.ttlSeconds).toBe(10 * 60);

    // Replayed like a cached 404: counted as a refusal every time, and as a
    // negative hit so it cannot inflate the rate.
    const day = new Date().toISOString().slice(0, 10);
    expect(kv.mem.get(`loop:stats:${day}:playlist_refused:playlist_empty`)?.value).toBe(3);
    const stats = await getCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.negativeHits).toBe(2);
  });

  it("rejects an unparseable URL without calling Spotify", async () => {
    await expect(loadPlaylist("https://example.com/not-a-playlist")).rejects.toMatchObject({
      status: 400,
    });
    expect(upstreamCalls()).toBe(0);
  });

  it("rejects an editorial playlist without calling Spotify", async () => {
    await expect(
      loadPlaylist("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
    ).rejects.toThrow(/editorial/i);
    expect(upstreamCalls()).toBe(0);
  });
});

describe("refusals are counted by reason", () => {
  // `playlist_refused:<code>` in lib/loop-stats.ts, read by `npm run stats`.
  // The hit-rate line could say one load in eight was a dead link and
  // nothing could say why; an editorial playlist, refused before the cache
  // is read, was in no count at all.
  const day = new Date().toISOString().slice(0, 10);
  const refused = (code: string) =>
    (kv.mem.get(`loop:stats:${day}:playlist_refused:${code}`)?.value as number | undefined) ?? 0;

  it("counts an editorial playlist, which no cache statistic sees", async () => {
    await expect(
      loadPlaylist("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
    ).rejects.toMatchObject({ code: "playlist_editorial" });
    expect(refused("playlist_editorial")).toBe(1);
    expect(refused("playlist_not_found")).toBe(0);
  });

  it("counts a 404 on the cold load and on every replay from the negative cache", async () => {
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ code: "playlist_not_found" });
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ code: "playlist_not_found" });
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ code: "playlist_not_found" });
    // Every one is a host told their link is dead; the retry is the point.
    expect(refused("playlist_not_found")).toBe(3);
    expect(upstreamCalls()).toBe(1);
  });

  it("counts an unparseable URL and an empty playlist under their own codes", async () => {
    await expect(loadPlaylist("https://example.com/not-a-playlist")).rejects.toMatchObject({
      code: "invalid_playlist_url",
    });
    expect(refused("invalid_playlist_url")).toBe(1);

    upstream().mockResolvedValue(upstreamResult([]));
    await loadPlaylist(URL_A);
    expect(refused("playlist_empty")).toBe(1);
  });

  it("does not count a throttling refusal — that is the budget's number, and it clears", async () => {
    upstream().mockRejectedValue(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 60 })
    );
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 429 });
    for (const code of ["playlist_not_found", "playlist_editorial", "playlist_empty", "invalid_playlist_url"]) {
      expect(refused(code)).toBe(0);
    }
    expect([...kv.mem.keys()].some((k) => k.includes("playlist_refused:"))).toBe(false);
  });

  it("does not count a successful load", async () => {
    await loadPlaylist(URL_A);
    expect([...kv.mem.keys()].some((k) => k.includes("playlist_refused:"))).toBe(false);
  });
});

describe("a link that was never a playlist is named, and counted by what it was", () => {
  // `playlist_refused:invalid_playlist_url` read 748 in a week and could not
  // be read: an album, a track, an artist page, a short link and a line of
  // chat were one number and one sentence.
  const day = new Date().toISOString().slice(0, 10);
  const stat = (metric: string) =>
    (kv.mem.get(`loop:stats:${day}:${metric}`)?.value as number | undefined) ?? 0;
  const KINDS = ["track", "artist", "shortlink", "other"] as const;
  const split = () => KINDS.reduce((total, kind) => total + stat(`playlist_invalid:${kind}`), 0);

  it("answers a track and an artist link with its own code, and never asks Spotify", async () => {
    for (const kind of ["track", "artist"] as const) {
      await expect(
        loadPlaylist(`https://open.spotify.com/intl-ja/${kind}/${playlistId(kind)}?si=x`)
      ).rejects.toMatchObject({ code: `playlist_link_${kind}`, status: 400 });
      expect(stat(`playlist_invalid:${kind}`)).toBe(1);
    }
    expect(upstreamCalls()).toBe(0);
    expect(albumUpstreamCalls()).toBe(0);
    // Before the cache is read and before any budget is claimed.
    expect([...kv.mem.keys()].some((k) => k.startsWith("spotify:budget"))).toBe(false);
  });

  it("still counts every one of them as invalid_playlist_url, so the weekly series keeps its meaning", async () => {
    // The host reads "that's a song"; the counter that read 748 still
    // moves. The four parts are written in the same call as the total, so
    // they sum to it exactly.
    const pasted = [
      `https://open.spotify.com/track/${playlistId("x")}`,
      `spotify:track:${playlistId("y")}`,
      `https://open.spotify.com/artist/${playlistId("z")}`,
      "my party mix",
      "https://example.com/not-a-playlist",
      `https://open.spotify.com/track/${playlistId("x")}`, // a retry counts again
    ];
    for (const link of pasted) await loadPlaylist(link).catch(() => {});

    expect(stat("playlist_refused:invalid_playlist_url")).toBe(pasted.length);
    expect(split()).toBe(pasted.length);
    expect(stat("playlist_invalid:track")).toBe(3);
    expect(stat("playlist_invalid:other")).toBe(2);
    // An album is not among them any more, and nothing new joined the refusal set.
    expect(stat("playlist_invalid:album")).toBe(0);
    for (const code of ["playlist_link_album", "playlist_link_track", "playlist_link_artist"]) {
      expect(stat(`playlist_refused:${code}`)).toBe(0);
    }
  });

  it("refuses a malformed id without spending a call on being told it is nothing", async () => {
    // `[a-zA-Z0-9]+` used to send this upstream, where a 400 came back that
    // is neither cached nor deterministic — so every retry spent another.
    for (const link of [
      "https://open.spotify.com/playlist/abc123",
      `https://open.spotify.com/playlist/${playlistId("a")}x`,
      playlistId("a"),
    ]) {
      await expect(loadPlaylist(link), link).rejects.toMatchObject({
        code: "invalid_playlist_url",
        status: 400,
      });
    }
    expect(upstreamCalls()).toBe(0);
    expect(stat("playlist_invalid:other")).toBe(3);
  });

  it("refuses a playlist path that is not on Spotify", async () => {
    await expect(
      loadPlaylist(`https://example.com/playlist/${playlistId("a")}`)
    ).rejects.toMatchObject({ code: "invalid_playlist_url" });
    expect(upstreamCalls()).toBe(0);
  });

  it("names the link during a cooldown too — waiting will not make a track a playlist", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 120 })
    );
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 429 });

    await expect(
      loadPlaylist(`https://open.spotify.com/track/${playlistId("x")}`)
    ).rejects.toMatchObject({ code: "playlist_link_track", status: 400 });
  });

  it("loads what the old forms turned away and the server always took", async () => {
    // `/intl-ja/` and the pre-2018 `/user/` path fail
    // `includes("spotify.com/playlist")`. One id, one cache entry.
    await loadPlaylist(`https://open.spotify.com/intl-ja/playlist/${playlistId("a")}?si=x`);
    await loadPlaylist(`https://open.spotify.com/user/someone/playlist/${playlistId("a")}`);
    await loadPlaylist(`  來聽聽 ${URL_A} 超讚 `);
    expect(upstreamCalls()).toBe(1);
    expect(split()).toBe(0);
  });
});

describe("short links on the paste path", () => {
  const day = new Date().toISOString().slice(0, 10);
  const stat = (metric: string) =>
    (kv.mem.get(`loop:stats:${day}:${metric}`)?.value as number | undefined) ?? 0;
  const SHORT = "https://spotify.link/AbCdEfG";

  type Reply = { status: number; location?: string } | Error;

  /** `spotify.link` is never contacted: every request is answered from a script. */
  function redirector(...replies: Reply[]) {
    const queue = [...replies];
    const mock = vi.fn(async (url: string | URL) => {
      const reply = queue.shift();
      if (!reply) throw new Error(`unscripted request to ${String(url)}`);
      if (reply instanceof Error) throw reply;
      return new Response(null, {
        status: reply.status,
        headers: reply.location ? { location: reply.location } : {},
      });
    });
    vi.stubGlobal("fetch", mock);
    return { calls: () => mock.mock.calls.length, urls: () => mock.mock.calls.map((c) => String(c[0])) };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows a short link and loads the playlist it names", async () => {
    const net = redirector({ status: 307, location: `${URL_A}?si=x&_branch_match_id=1` });

    const result = await loadPlaylist(SHORT, "room-submit");

    expect(result.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(net.urls()).toEqual([SHORT]);
    // Spotify is asked by the playlist's own address. lib/spotify.ts cannot
    // read a short link and must never be handed one.
    expect(upstream()).toHaveBeenCalledWith(URL_A);
    expect(upstreamCalls()).toBe(1);
  });

  it("asks Spotify by the address built from the id, whatever was pasted", async () => {
    await loadPlaylist(`look at this https://open.spotify.com/intl-ja/playlist/${playlistId("a")}?si=x !!`);
    expect(upstream()).toHaveBeenCalledWith(URL_A);
  });

  it("shares one cache entry with the playlist's own link", async () => {
    redirector({ status: 307, location: URL_A });
    await loadPlaylist(URL_A);
    await loadPlaylist(SHORT);
    expect(upstreamCalls()).toBe(1);
  });

  it("does not follow a retried short link twice", async () => {
    const net = redirector({ status: 307, location: URL_A });
    await loadPlaylist(SHORT);
    await loadPlaylist(SHORT);
    await loadPlaylist(`${SHORT}?si=abc`);
    expect(net.calls()).toBe(1);
    expect(upstreamCalls()).toBe(1);
  });

  it("names what the short link led to, and counts it as that", async () => {
    redirector({ status: 307, location: `https://open.spotify.com/track/${playlistId("x")}` });

    await expect(loadPlaylist(SHORT)).rejects.toMatchObject({
      code: "playlist_link_track",
      status: 400,
    });
    // A track is a track however its link was spelled: the counter answers
    // what people are trying to play.
    expect(stat("playlist_invalid:track")).toBe(1);
    expect(stat("playlist_invalid:shortlink")).toBe(0);
    expect(stat("playlist_refused:invalid_playlist_url")).toBe(1);
    expect(upstreamCalls()).toBe(0);
  });

  it("follows a short link to an album and loads it, like a playlist's", async () => {
    redirector({ status: 307, location: `${albumUrlFor("x")}?si=abc` });

    const result = await loadPlaylist(SHORT, "room-submit");

    expect(result.kind).toBe("album");
    expect(result.name).toBe("My Album");
    expect(albumUpstream()).toHaveBeenCalledWith(playlistId("x"));
    expect(upstreamCalls()).toBe(0);
    expect(stat("playlist_album:loaded")).toBe(1);
    expect(stat("playlist_invalid:shortlink")).toBe(0);
    expect([...kv.mem.keys()].some((k) => k.includes("playlist_refused:"))).toBe(false);
  });

  it("refuses a dead short link for good, under its own bucket", async () => {
    redirector({ status: 404 });

    const err = await loadPlaylist(SHORT).catch((e) => e);
    expect(err).toMatchObject({ code: "invalid_playlist_url", status: 400 });
    expect(isDeterministicPlaylistFailure(err.code)).toBe(true);
    expect(stat("playlist_invalid:shortlink")).toBe(1);
    expect(stat("playlist_refused:invalid_playlist_url")).toBe(1);
    expect(upstreamCalls()).toBe(0);
  });

  it("answers a short link it could not follow with a code the host may retry", async () => {
    // A timeout says nothing about the link. If this were deterministic,
    // app/page.tsx would stop asking and strand a host whose link was fine.
    const net = redirector(
      new DOMException("The operation timed out.", "TimeoutError"),
      { status: 307, location: URL_A }
    );

    const err = await loadPlaylist(SHORT).catch((e) => e);
    expect(err).toBeInstanceOf(spotify.SpotifyApiError);
    expect(err).toMatchObject({ code: "playlist_shortlink_unavailable", status: 503 });
    expect(isDeterministicPlaylistFailure(err.code)).toBe(false);
    expect(err.message).not.toMatch(/doesn't look like|not a playlist|public/i);

    // Not a refusal, so none is counted — and nothing went to Spotify.
    expect([...kv.mem.keys()].some((k) => k.includes("playlist_refused:"))).toBe(false);
    expect([...kv.mem.keys()].some((k) => k.includes("playlist_invalid:"))).toBe(false);
    expect(stat("playlist_shortlink:unavailable")).toBe(1);
    expect(upstreamCalls()).toBe(0);

    // The second press goes out again, and works.
    await expect(loadPlaylist(SHORT)).resolves.toMatchObject({ totalTracks: 2 });
    expect(net.calls()).toBe(2);
  });

  it("claims none of Spotify's budget for a short link that led nowhere", async () => {
    redirector({ status: 404 }, new TypeError("fetch failed"));
    await loadPlaylist(SHORT).catch(() => {});
    await loadPlaylist("https://spotify.link/Another").catch(() => {});

    expect([...kv.mem.keys()].some((k) => k.startsWith("spotify:"))).toBe(false);
    expect([...kv.mem.keys()].some((k) => k.startsWith("playlist:stats:"))).toBe(false);
  });

  it("refuses one of Spotify's own playlists reached through a short link", async () => {
    redirector({
      status: 307,
      location: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x",
    });
    await expect(loadPlaylist(SHORT)).rejects.toMatchObject({ code: "playlist_editorial" });
    expect(stat("playlist_refused:playlist_editorial")).toBe(1);
    expect(upstreamCalls()).toBe(0);
  });

  it("still follows the link when KV is down", async () => {
    kv.flags.failReads = true;
    kv.flags.failWrites = true;
    redirector({ status: 307, location: URL_A });
    await expect(loadPlaylist(SHORT)).resolves.toMatchObject({ totalTracks: 2 });
  });

  describe("as POST /api/playlist answers it", () => {
    // The wire is what the setup page decides from: `code` picks the
    // sentence and whether Start may ask again, and the status is for the
    // logs. Both have to survive the route.
    const post = (url: unknown) =>
      postPlaylist(
        new NextRequest("http://127.0.0.1:8000/api/playlist", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
          body: JSON.stringify({ url }),
        })
      );

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("loads a short link like any other playlist", async () => {
      redirector({ status: 307, location: URL_A });
      const res = await post(SHORT);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ name: "My Playlist", totalTracks: 2 });
    });

    it("loads an album like any other playlist", async () => {
      const res = await post(albumUrlFor("x"));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ name: "My Album", totalTracks: 2 });
    });

    it("names an album Spotify has not got with a code the page will not retry", async () => {
      albumUpstream().mockRejectedValue(new spotify.SpotifyApiError("album_not_found", 404));
      const res = await post(albumUrlFor("x"));
      const body = await res.json();
      expect(res.status).toBe(404);
      expect(body.code).toBe("album_not_found");
      expect(body.error).toMatch(/album/i);
      expect(body.error).not.toMatch(/public|private/i);
      expect(isDeterministicPlaylistFailure(body.code)).toBe(true);
    });

    it("names a track with a code the page will not retry", async () => {
      const res = await post(`https://open.spotify.com/track/${playlistId("x")}`);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.code).toBe("playlist_link_track");
      expect(isDeterministicPlaylistFailure(body.code)).toBe(true);
    });

    it("answers a short link it could not follow as ours and temporary", async () => {
      redirector(new TypeError("fetch failed"));
      const res = await post(SHORT);
      const body = await res.json();
      // Not a 400: that would file it in the logs beside the links that are
      // simply wrong. And never a 429 — nothing is being throttled.
      expect(res.status).toBe(503);
      expect(body.code).toBe("playlist_shortlink_unavailable");
      expect(isDeterministicPlaylistFailure(body.code)).toBe(false);
      expect(body.retryAfter).toBeUndefined();
    });

    it("keeps the short-link fetch behind the route's own limiter", async () => {
      // 30 per 10 minutes per address. The 31st is refused before anything
      // is classified, so it cannot cost an outbound request.
      const net = redirector(
        ...Array.from({ length: 40 }, () => ({ status: 404 }))
      );
      for (let i = 0; i < 30; i += 1) await post(`https://spotify.link/Slug${i}`);
      expect(net.calls()).toBe(30);

      const res = await post("https://spotify.link/OneTooMany");
      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toMatchObject({ code: "rate_limited_playlist" });
      expect(net.calls()).toBe(30);
    });
  });
});

describe("an album link", () => {
  // `playlist_invalid:album` read ~245 a week of these being turned away.
  // Every layer below is the playlist's, shared — what is pinned here is
  // that an album reaches the album endpoint, under its own key, and is
  // counted both ways.
  const day = new Date().toISOString().slice(0, 10);
  const stat = (metric: string) =>
    (kv.mem.get(`loop:stats:${day}:${metric}`)?.value as number | undefined) ?? 0;
  const ALBUM_X = albumUrlFor("x");

  it("loads through the album endpoint, never the playlist one, and says what it was", async () => {
    const result = await loadPlaylist(ALBUM_X, "playlist-api");

    expect(result.kind).toBe("album");
    expect(result.name).toBe("My Album");
    expect(result.tracks.map((t) => t.id)).toEqual(["x1", "x2"]);
    expect(albumUpstream()).toHaveBeenCalledWith(playlistId("x"));
    expect(upstreamCalls()).toBe(0);
  });

  it("is cached under its own key, and a repeat costs nothing upstream", async () => {
    await loadPlaylist(ALBUM_X);
    await loadPlaylist(`spotify:album:${playlistId("x")}`);
    await loadPlaylist(`  聽這張 ${ALBUM_X}?si=zz `);

    expect(albumUpstreamCalls()).toBe(1);
    const write = kv.writes.find((w) => w.key.startsWith("album:"));
    expect(write?.key).toBe(`album:v1:${playlistId("x")}`);
    expect(kv.writes.some((w) => w.key.startsWith("playlist:v1:"))).toBe(false);
    // The same TTL rules as a playlist: a day fresh, a week in all.
    expect(write?.ttlSeconds).toBe(7 * 24 * 60 * 60);
  });

  it("never shares an entry with a playlist that happens to have the same id", async () => {
    await loadPlaylist(URL_A);
    await loadPlaylist(albumUrlFor("a"));
    expect(upstreamCalls()).toBe(1);
    expect(albumUpstreamCalls()).toBe(1);
    expect(kv.writes.map((w) => w.key).filter((k) => /^(playlist|album):v1:/.test(k))).toEqual([
      `playlist:v1:${playlistId("a")}`,
      `album:v1:${playlistId("a")}`,
    ]);
  });

  it("does not apply the editorial rule — 37i9 is a playlist-id convention", async () => {
    await expect(loadPlaylist("https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M")).resolves.toMatchObject({
      kind: "album",
    });
    expect(albumUpstreamCalls()).toBe(1);
    expect(stat("playlist_refused:playlist_editorial")).toBe(0);
  });

  it("counts a load that played, hit or miss, and never an empty one", async () => {
    await loadPlaylist(ALBUM_X);
    await loadPlaylist(ALBUM_X);
    expect(stat("playlist_album:loaded")).toBe(2);
    expect(albumUpstreamCalls()).toBe(1);

    albumUpstream().mockResolvedValue(albumResult([]));
    await loadPlaylist(albumUrlFor("e"));
    expect(stat("playlist_album:loaded")).toBe(2);
    expect(stat("playlist_refused:playlist_empty")).toBe(1);

    // A playlist never counts here.
    await loadPlaylist(URL_A);
    expect(stat("playlist_album:loaded")).toBe(2);
  });

  it("remembers an album Spotify has not got as its own refusal, and replays it", async () => {
    albumUpstream().mockRejectedValue(new spotify.SpotifyApiError("album_not_found", 404));

    for (let i = 0; i < 3; i += 1) {
      const err = await loadPlaylist(ALBUM_X).catch((e) => e);
      expect(err).toMatchObject({ code: "album_not_found", status: 404 });
      expect(isDeterministicPlaylistFailure(err.code)).toBe(true);
    }
    expect(albumUpstreamCalls()).toBe(1);
    // Counted as a fifth permanent refusal, every replay included, and
    // never as the playlist's "private or deleted".
    expect(stat("playlist_refused:album_not_found")).toBe(3);
    expect(stat("playlist_refused:playlist_not_found")).toBe(0);
    expect(stat("playlist_album:loaded")).toBe(0);
    expect(kv.writes.find((w) => w.key.startsWith("album:v1:"))?.ttlSeconds).toBe(10 * 60);
  });

  it("is parked by a cooldown like a playlist, and spends the same budget", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 60 })
    );
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 429 });
    await expect(loadPlaylist(ALBUM_X)).rejects.toMatchObject({ status: 429 });
    expect(albumUpstreamCalls()).toBe(0);
  });
});

describe("in-flight coalescing", () => {
  it("collapses concurrent loads of the same playlist into one upstream fetch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    upstream().mockImplementation(async () => {
      await gate;
      return upstreamResult(["a"]);
    });

    // Mixed mode fires one request per contributor from a single click, and a
    // QR room gets a burst of submits — duplicate URLs in either used to mean
    // duplicate pagination, because the cache write lands too late to help
    // its own siblings.
    const all = Promise.all([loadPlaylist(URL_A), loadPlaylist(URL_A), loadPlaylist(URL_A)]);
    release();
    const results = await all;

    expect(upstreamCalls()).toBe(1);
    expect(results.every((r) => r.tracks.length === 1)).toBe(true);
  });

  it("does not coalesce different playlists", async () => {
    await Promise.all([loadPlaylist(URL_A), loadPlaylist(URL_B)]);
    expect(upstreamCalls()).toBe(2);
  });

  it("clears the in-flight entry after a failure, so a later retry is not stuck", async () => {
    upstream().mockRejectedValueOnce(new spotify.SpotifyApiError("playlist_load_failed", 500));
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 500 });

    upstream().mockResolvedValue(upstreamResult(["a"]));
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 1 });
  });
});

describe("404 negative caching", () => {
  it("remembers a missing playlist so a retry burst costs one upstream call", async () => {
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));

    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ code: "playlist_not_found" });
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 404 });
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 404 });

    expect(upstreamCalls()).toBe(1);
  });

  it("holds a 404 for far less time than a successful load", async () => {
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    const missTtl = kv.writes.at(-1)!.ttlSeconds;

    kv.mem.clear();
    upstream().mockResolvedValue(upstreamResult(["a"]));
    await loadPlaylist(URL_A);
    const hitTtl = kv.writes.at(-1)!.ttlSeconds;

    // A host who fixes their playlist's visibility must not keep being told
    // it's broken.
    expect(missTtl).toBeLessThan(hitTtl);
  });

  it("holds a loaded playlist fresh long enough to cover tomorrow night", async () => {
    const before = Date.now();
    await loadPlaylist(URL_A);

    // Parties are nightly, so six hours meant a playlist first loaded at 8pm
    // was cold again by 8pm the next day: 406 warm keys against 2,152 cold
    // loads in a day, every miss spending the app's shared Spotify quota.
    const write = kv.writes.find((w) => w.key.startsWith("playlist:"))!;
    const freshUntil = (write.value as { freshUntil: number }).freshUntil;
    expect(freshUntil - before).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(freshUntil - before).toBeLessThan(24 * 60 * 60 * 1000 + 5000);
    // The key outlives its freshness by the stale grace, a week in all.
    expect(write.ttlSeconds).toBe(7 * 24 * 60 * 60);
  });

  it("does not cache a 5xx — that is Spotify's problem, not the playlist's", async () => {
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_load_failed", 503));

    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    await expect(loadPlaylist(URL_A)).rejects.toThrow();

    expect(upstreamCalls()).toBe(2);
  });
});

describe("429 cooldown", () => {
  it("parks further uncached loads after Spotify reports a 429", async () => {
    upstream().mockRejectedValueOnce(new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 45 }));
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 429 });

    // A different playlist, and the upstream mock is healthy again — but the
    // quota is per app, so going back out would just spend more of it.
    upstream().mockResolvedValue(upstreamResult(["c"]));
    await expect(loadPlaylist(URL_B)).rejects.toMatchObject({ status: 429 });

    expect(upstreamCalls()).toBe(1);
  });

  it("still serves cached playlists during a cooldown", async () => {
    await loadPlaylist(URL_A);

    upstream().mockRejectedValueOnce(new spotify.SpotifyApiError("spotify_rate_limited", 429));
    await expect(loadPlaylist(URL_B)).rejects.toMatchObject({ status: 429 });

    // The party already holding a loaded playlist must not be taken down by
    // someone else's throttling.
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
  });

  it("stores the real wait but lets the key expire early enough to re-check", async () => {
    // Production, 2026-08-23: `retry-after: 52531`, `reason: QUOTA_EXCEEDED`.
    // The two numbers here used to be one, and the single number got both
    // jobs wrong — a 15-minute clamp told the host a wait the app could not
    // honour, and re-opened the gate on a quota that had 14 hours left to run.
    const before = Date.now();
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 52531 })
    );
    await expect(loadPlaylist(URL_A)).rejects.toThrow();

    const cooldown = kv.writes.find((w) => w.key === "spotify:cooldown")!;

    // The value is what the host is told: the truth, hours and all.
    const until = (cooldown.value as { until: number }).until;
    expect(until - before).toBeGreaterThanOrEqual(52530 * 1000);

    // The TTL is when we go and ask again, so one bad header cannot lock the
    // site out for a day with no way back.
    expect(cooldown.ttlSeconds).toBe(15 * 60);
  });

  it("drops the countdown once the wait is measured in hours", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 52531 })
    );
    const err = await loadPlaylist(URL_A).catch((e) => e);

    // "Try again in about 52531s" is not a wait, it is a dismissal. The host
    // gets told what is actually true instead, and the header keeps the number.
    expect(err.code).toBe("spotify_quota_exhausted");
    expect(err.params).toBeUndefined();
    expect(err.retryAfterSeconds).toBeGreaterThan(52000);
  });

  it("keeps the countdown when the wait is short enough to sit through", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 45 })
    );
    const err = await loadPlaylist(URL_A).catch((e) => e);

    expect(err.code).toBe("spotify_cooldown");
    expect(err.params).toMatchObject({ seconds: 45 });
  });

  it("caps an absurd Retry-After at a day rather than trusting it", async () => {
    // The stored value is what the host is told, so it follows Spotify — but
    // only so far. A malformed or hostile header must not be able to park every
    // uncached playlist for a week; a day is past any real quota window.
    const before = Date.now();
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 30 * 86400 })
    );
    await expect(loadPlaylist(URL_A)).rejects.toThrow();

    const cooldown = kv.writes.find((w) => w.key === "spotify:cooldown")!;
    const until = (cooldown.value as { until: number }).until;
    expect(until - before).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    expect(until - before).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("applies a floor when Spotify sends no Retry-After at all", async () => {
    upstream().mockRejectedValueOnce(new spotify.SpotifyApiError("spotify_rate_limited", 429));
    await expect(loadPlaylist(URL_A)).rejects.toThrow();

    const cooldown = kv.writes.find((w) => w.key === "spotify:cooldown");
    expect(cooldown!.ttlSeconds).toBeGreaterThanOrEqual(30);
  });

  it("tells the user to wait rather than to fix their URL", async () => {
    upstream().mockRejectedValueOnce(new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 60 }));
    const err = await loadPlaylist(URL_A).catch((e) => e);

    expect(err.message).toMatch(/rate limit/i);
    expect(err.message).not.toMatch(/public/i);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("global upstream budget", () => {
  beforeEach(() => {
    process.env.SPOTIFY_MAX_LOADS_PER_MINUTE = "3";
  });

  afterEach(() => {
    delete process.env.SPOTIFY_MAX_LOADS_PER_MINUTE;
  });

  it("refuses new playlists past the per-minute ceiling before Spotify does", async () => {
    for (let i = 0; i < 3; i++) {
      upstream().mockResolvedValue(upstreamResult([`t${i}`]));
      await loadPlaylist(urlFor(`pl${i}`));
    }
    expect(upstreamCalls()).toBe(3);

    await expect(
      loadPlaylist(urlFor("pl9"))
    ).rejects.toMatchObject({ status: 429 });

    // The point is that the 4th never left the building.
    expect(upstreamCalls()).toBe(3);
  });

  it("does not spend budget on cached playlists", async () => {
    await loadPlaylist(URL_A);

    // Ten more reads of an already-known playlist, against a ceiling of 3.
    for (let i = 0; i < 10; i++) {
      await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
    }
    expect(upstreamCalls()).toBe(1);
  });

  it("tells the user to wait rather than to fix their URL", async () => {
    for (let i = 0; i < 3; i++) {
      await loadPlaylist(urlFor(`pl${i}`));
    }

    const err = await loadPlaylist(urlFor("pl9")).catch((e) => e);
    expect(err.message).toMatch(/try again/i);
    expect(err.message).not.toMatch(/public/i);
  });

  it("fails open when KV is unavailable, rather than blocking every load", async () => {
    kv.flags.failReads = true;
    kv.flags.failWrites = true;

    // A budget that can't be read must not become a budget of zero.
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
  });
});

describe("cache hit-rate stats", () => {
  it("counts a cold load as a miss and a repeat as a hit", async () => {
    await loadPlaylist(URL_A);
    await loadPlaylist(URL_A);
    await loadPlaylist(URL_A);

    const stats = await getCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  it("counts a cached 404 as a hit — it answered without touching Spotify", async () => {
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    await expect(loadPlaylist(URL_A)).rejects.toThrow();

    const stats = await getCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it("reports replayed 404s separately, so a dead link can't inflate the rate", async () => {
    // Two loads of a good playlist (1 miss, 1 hit) and three retries of a dead
    // one. The raw rate reads 0.800, which without this breakdown is
    // indistinguishable from a cache doing genuinely well.
    await loadPlaylist(URL_A);
    await loadPlaylist(URL_A);

    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));
    await expect(loadPlaylist(URL_B)).rejects.toThrow();
    await expect(loadPlaylist(URL_B)).rejects.toThrow();
    await expect(loadPlaylist(URL_B)).rejects.toThrow();

    const stats = await getCacheStats();
    expect(stats.hits).toBe(3);
    expect(stats.negativeHits).toBe(2);
    // Subtracting them leaves the rate that actually describes real playlists.
    expect(stats.hits - stats.negativeHits).toBe(1);
  });

  it("reports a zero rate rather than NaN before anything has loaded", async () => {
    expect((await getCacheStats()).hitRate).toBe(0);
    expect((await getCacheStats()).negativeHits).toBe(0);
  });
});

describe("miss log", () => {
  /**
   * The log viewer attributes a line to whichever request the instance was
   * serving, which under concurrent invocations can be a route that never
   * calls this file. The line has to identify its own caller, or reading the
   * method off the log row points at a code path that cannot produce it.
   */
  it("names the caller that triggered the upstream load", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await loadPlaylist(URL_A, "room-submit");

    expect(log).toHaveBeenCalledWith(expect.stringContaining("source=room-submit"));
    log.mockRestore();
  });

  it("says so when a caller does not identify itself", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await loadPlaylist(URL_A);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("source=unknown"));
    log.mockRestore();
  });

  it("names the quiz's create route, the third caller that can spend a cold load", async () => {
    // POST /api/quiz goes through loadPlaylist like every other caller. A
    // quiz's cold loads must be tellable apart from a party's in the miss log,
    // or a spike in one reads as the other.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await loadPlaylist(URL_A, "quiz-create");

    expect(log).toHaveBeenCalledWith(expect.stringContaining("source=quiz-create"));
    log.mockRestore();
  });
});

describe("sampled playlists", () => {
  it("caches a truncated playlist for less time than a complete one", async () => {
    upstream().mockResolvedValue(upstreamResult(["a"], true));
    await loadPlaylist(URL_A);
    const sampledTtl = kv.writes.find((w) => w.key.startsWith("playlist:"))!.ttlSeconds;

    kv.mem.clear();
    kv.writes.length = 0;
    __resetInFlightForTests();
    upstream().mockResolvedValue(upstreamResult(["a"], false));
    await loadPlaylist(URL_A);
    const fullTtl = kv.writes.find((w) => w.key.startsWith("playlist:"))!.ttlSeconds;

    // A truncated entry is one random draw of 500. Holding it as long as a
    // complete playlist would mean the same 500 songs all evening, which is
    // the thing sampling exists to avoid.
    expect(sampledTtl).toBeLessThan(fullTtl);
  });
});

describe("KV degradation", () => {
  it("still loads when the cache cannot be read", async () => {
    kv.flags.failReads = true;

    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
  });

  it("still loads when the cache cannot be written", async () => {
    kv.flags.failWrites = true;

    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
  });
});

/**
 * The read-only half of the cooldown, used by the site notice.
 *
 * The property that matters is that it agrees with the error a host would get
 * from the same state, and that asking costs nothing upstream — a notice that
 * spent a Spotify call to report that Spotify calls are failing would be a
 * joke at the quota's expense.
 */
describe("getSpotifyServiceStatus", () => {
  it("reports open when nothing is parked", async () => {
    await expect(getSpotifyServiceStatus()).resolves.toEqual({
      throttled: false,
      approachingLimit: false,
      code: null,
      retryAfterSeconds: 0,
    });
  });

  it("reports a blip with the same code the host would be shown", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 90 })
    );
    const err = await loadPlaylist(URL_A).catch((e) => e);

    const status = await getSpotifyServiceStatus();
    expect(status.throttled).toBe(true);
    expect(status.code).toBe("spotify_cooldown");
    expect(status.code).toBe(err.code);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reports a spent daily quota with the countdown-free code", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 48513 })
    );
    const err = await loadPlaylist(URL_A).catch((e) => e);

    const status = await getSpotifyServiceStatus();
    expect(status.code).toBe("spotify_quota_exhausted");
    expect(status.code).toBe(err.code);
    // Honest, even though the message that renders it carries no {seconds}.
    expect(status.retryAfterSeconds).toBeGreaterThan(10 * 60);
  });

  it("never reaches Spotify", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 90 })
    );
    await loadPlaylist(URL_A).catch(() => {});
    const before = upstreamCalls();

    await getSpotifyServiceStatus();
    await getSpotifyServiceStatus();

    expect(upstreamCalls()).toBe(before);
  });

  /**
   * Fail open, like every other KV consumer here. A cache outage must not put
   * a "we are broken" notice on a site that is, as far as anyone can tell,
   * fine.
   */
  it("reports open when KV cannot be read", async () => {
    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 90 })
    );
    await loadPlaylist(URL_A).catch(() => {});

    kv.flags.failReads = true;

    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({
      throttled: false,
      code: null,
    });
  });
});

/**
 * The gate the per-minute one cannot be: Spotify refuses on a rolling ~24h
 * quota, and 40-a-minute is never reached by a day's worth of traffic
 * arriving at one or two loads a minute. Every assertion here is again about
 * upstream call *count* — the point is not the error, it is that the call
 * never left the building.
 */
describe("rolling 24h upstream budget", () => {
  beforeEach(() => {
    process.env.SPOTIFY_MAX_LOADS_PER_DAY = "3";
  });

  afterEach(() => {
    delete process.env.SPOTIFY_MAX_LOADS_PER_DAY;
  });

  const uniqueUrl = (i: number) => urlFor(`d${i}`);

  it("refuses new playlists past the daily ceiling before Spotify does", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));
    expect(upstreamCalls()).toBe(3);

    await expect(loadPlaylist(uniqueUrl(9))).rejects.toMatchObject({
      code: "spotify_daily_budget_spent",
      status: 429,
    });
    expect(upstreamCalls()).toBe(3);
  });

  it("does not spend the day's budget on cached playlists", async () => {
    await loadPlaylist(URL_A);
    for (let i = 0; i < 10; i++) {
      await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
    }

    // One load spent, so two of a ceiling of three are still there.
    await expect(getDailyBudgetStatus()).resolves.toMatchObject({ used: 1, limit: 3 });
    expect(upstreamCalls()).toBe(1);
  });

  /**
   * The ordering rule in `fetchAndCache`, pinned. A load turned away for
   * bursting never went upstream, so it must not spend a slot in a window that
   * takes a day to give one back — otherwise a single burst permanently
   * shrinks the day.
   */
  it("does not spend the day's budget on a load the per-minute gate refused", async () => {
    process.env.SPOTIFY_MAX_LOADS_PER_MINUTE = "1";
    try {
      await loadPlaylist(uniqueUrl(0));
      await expect(loadPlaylist(uniqueUrl(1))).rejects.toMatchObject({ code: "spotify_busy" });
    } finally {
      delete process.env.SPOTIFY_MAX_LOADS_PER_MINUTE;
    }

    await expect(getDailyBudgetStatus()).resolves.toMatchObject({ used: 1, refused: 0 });
  });

  /**
   * The counterpart, and the reason this gate reads before it increments: a
   * refusal that counted itself would inflate the sum that caused it and hold
   * the window shut for a day.
   */
  it("counts its own refusals separately from the loads it allowed", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));
    for (let i = 0; i < 4; i++) await loadPlaylist(uniqueUrl(9)).catch(() => {});

    await expect(getDailyBudgetStatus()).resolves.toMatchObject({
      used: 3,
      refused: 4,
      limit: 3,
    });
  });

  it("sums the window across hours rather than resetting at midnight", async () => {
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const hour = (at: Date) => at.toISOString().slice(0, 13);

    // Two loads recorded an hour ago, by hand, in the shape the gate writes.
    kv.mem.set(`spotify:budget:h:${hour(anHourAgo)}`, {
      value: 2,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    // One more fits; the next does not, even though this hour has spent one.
    await loadPlaylist(uniqueUrl(0));
    await expect(loadPlaylist(uniqueUrl(1))).rejects.toMatchObject({
      code: "spotify_daily_budget_spent",
    });
    expect(upstreamCalls()).toBe(1);

    const status = await getDailyBudgetStatus(now);
    expect(status.used).toBe(3);
    expect(status.byHour.at(-1)).toMatchObject({ hour: hour(now), used: 1 });
  });

  it("tells the host to wait rather than to fix their URL", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));

    const err = await loadPlaylist(uniqueUrl(9)).catch((e) => e);
    // The hazard lib/error-messages.ts pins in both languages: a refusal that
    // sends the host back to editing a URL that was always fine.
    expect(err.message).not.toMatch(/public/i);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it("fails open when KV is unavailable, rather than blocking every load", async () => {
    kv.flags.failReads = true;
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
    expect(upstreamCalls()).toBe(1);
  });

  /**
   * There are two ways for the playlist path to be shut, and the site notice
   * has to know about both. A banner blind to this gate would leave hosts
   * pasting a link to find out what the page could have told them — which is
   * the whole thing 1.7.2 exists to stop.
   */
  it("shows up in the service notice, not just at the Start button", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));
    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({ throttled: false });

    await loadPlaylist(uniqueUrl(9)).catch(() => {});

    const status = await getSpotifyServiceStatus();
    expect(status).toMatchObject({ throttled: true, code: "spotify_daily_budget_spent" });
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });

  /**
   * The warning, and the reason it exists at all: a host who is told at the
   * refusal has already lost the choice of loading their playlist while there
   * was still allowance for it. At a ceiling of 3 the 0.8 ratio trips on the
   * third load — the last one that succeeds.
   */
  it("warns while the site still works, before anything is refused", async () => {
    for (let i = 0; i < 2; i++) await loadPlaylist(uniqueUrl(i));
    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({
      throttled: false,
      approachingLimit: false,
      code: null,
    });

    await loadPlaylist(uniqueUrl(2));

    const status = await getSpotifyServiceStatus();
    expect(status).toMatchObject({
      throttled: false,
      approachingLimit: true,
      code: "spotify_budget_low",
    });
    // A level, not a wait. The message carries no {seconds} for that reason.
    expect(status.retryAfterSeconds).toBe(0);
  });

  it("is retunable without a deploy", async () => {
    process.env.SPOTIFY_BUDGET_WARN_RATIO = "0.99";
    try {
      // 3 * 0.99 = 2.97, so two loads no longer reach it where 0.8 would have.
      for (let i = 0; i < 2; i++) await loadPlaylist(uniqueUrl(i));
      await expect(getSpotifyServiceStatus()).resolves.toMatchObject({
        approachingLimit: false,
      });
    } finally {
      delete process.env.SPOTIFY_BUDGET_WARN_RATIO;
    }
  });

  /**
   * The refusal replaces the warning rather than sitting alongside it. Telling
   * a host "you are close to the limit" once they are past it says the site
   * still works, which is the one thing it does not do.
   */
  it("stops warning once it is actually refusing", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));
    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({
      approachingLimit: true,
    });

    await loadPlaylist(uniqueUrl(9)).catch(() => {});

    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({
      throttled: true,
      approachingLimit: false,
      code: "spotify_daily_budget_spent",
    });
  });

  /**
   * The status route's whole cost claim is one KV read, and the warning must
   * not have quietly turned that into twenty-four. Reading it is one more key
   * in the `mget` the notice already spends.
   */
  it("costs the notice no extra KV reads", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));
    const before = kv.counts.reads;
    await getSpotifyServiceStatus();
    // One `mget`, exactly as before the warning existed. Answering it by
    // summing the day's hourly buckets here would have made the notice more
    // expensive than the gate it reports on.
    expect(kv.counts.reads - before).toBe(1);
  });

  /**
   * Spotify's own refusal outranks ours: it is the longer wait and the one the
   * host can do nothing about.
   */
  it("yields to a real Spotify cooldown when both are live", async () => {
    for (let i = 0; i < 3; i++) await loadPlaylist(uniqueUrl(i));
    await loadPlaylist(uniqueUrl(9)).catch(() => {});

    upstream().mockRejectedValueOnce(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 52531 })
    );
    delete process.env.SPOTIFY_MAX_LOADS_PER_DAY;
    await loadPlaylist(URL_B).catch(() => {});

    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({
      throttled: true,
      code: "spotify_quota_exhausted",
    });
  });
});

describe("a stale copy, served when Spotify cannot be asked", () => {
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SPOTIFY_MAX_LOADS_PER_DAY;
  });

  async function loadThenAge(ms: number) {
    await loadPlaylist(URL_A);
    vi.setSystemTime(new Date(Date.now() + ms));
    __resetInFlightForTests();
  }

  it("still serves a fresh entry without asking", async () => {
    await loadThenAge(DAY - 60_000);
    await loadPlaylist(URL_A);
    expect(upstreamCalls()).toBe(1);
  });

  it("refreshes a stale entry when Spotify is fine, and counts it as a miss a longer TTL would save", async () => {
    await loadThenAge(2 * DAY);
    upstream().mockResolvedValue(upstreamResult(["a", "b", "c"]));

    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 3 });
    expect(upstreamCalls()).toBe(2);
    await expect(getCacheStats()).resolves.toMatchObject({ refreshed: 1, staleHits: 0 });
  });

  it("serves the stale copy without a call once the day is near its ceiling", async () => {
    process.env.SPOTIFY_MAX_LOADS_PER_DAY = "2";
    await loadThenAge(2 * DAY);
    // The first load's hour has rolled out of the window by now, so two fresh
    // ones: the second crosses the warning ratio of a ceiling of two, while one
    // slot is still unspent — the notice is up and the gate is still open.
    await loadPlaylist(urlFor("near1"));
    await loadPlaylist(urlFor("near2"));
    await expect(getSpotifyServiceStatus()).resolves.toMatchObject({ approachingLimit: true });
    const calls = upstreamCalls();

    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
    expect(upstreamCalls()).toBe(calls);
    await expect(getCacheStats()).resolves.toMatchObject({ staleHits: 1 });
  });

  it("serves the stale copy when Spotify refuses the refresh", async () => {
    await loadThenAge(3 * DAY);
    upstream().mockRejectedValue(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 60 })
    );

    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
    // And the cooldown that refusal started parks the next one without asking.
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
    expect(upstreamCalls()).toBe(2);
  });

  it("serves the stale copy on an upstream error that says nothing about the playlist", async () => {
    await loadThenAge(3 * DAY);
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_load_failed", 503));
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ totalTracks: 2 });
  });

  it("believes a 404 on refresh — the owner made it private, and that is theirs to decide", async () => {
    await loadThenAge(2 * DAY);
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ code: "playlist_not_found" });
  });

  it("keeps nothing past a week", async () => {
    await loadThenAge(7 * DAY + 60_000);
    upstream().mockRejectedValue(
      new spotify.SpotifyApiError("spotify_rate_limited", 429, { retryAfterSeconds: 60 })
    );
    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ status: 429 });
  });

  it("gives an empty playlist no grace — it is a refusal", async () => {
    upstream().mockResolvedValue(upstreamResult([]));
    await loadPlaylist(URL_A);
    const write = kv.writes.find((w) => w.key.startsWith("playlist:"))!;
    expect(write.ttlSeconds).toBe(10 * 60);
  });

  it("treats an entry written before freshUntil existed as fresh for its own TTL", async () => {
    kv.mem.set(`playlist:v1:${playlistId("a")}`, {
      value: { kind: "hit", name: "Old", tracks: [makeTrack("x")], truncated: false },
      expiresAt: Date.now() + 60_000,
    });
    await expect(loadPlaylist(URL_A)).resolves.toMatchObject({ name: "Old" });
    expect(upstreamCalls()).toBe(0);
  });
});

describe("rechecking a playlist the host has just made public", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    upstream().mockRejectedValue(new spotify.SpotifyApiError("playlist_not_found", 404));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const counts = (prefix: string) =>
    Object.fromEntries(
      ["found", "missing", "replayed", "other"].map((o) => [
        o,
        (kv.mem.get(`loop:stats:2026-10-13:${prefix}:${o}`)?.value as number) ?? 0,
      ])
    );
  const recheckCounts = () => counts("playlist_recheck");
  const autocheckCounts = () => counts("playlist_autocheck");

  it("goes past a cached 404 when asked to, and lets the host through", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult(["a"]));

    await expect(loadPlaylist(URL_A, "playlist-api", { recheck: true })).resolves.toMatchObject({
      totalTracks: 1,
    });
    expect(upstreamCalls()).toBe(2);
    expect(recheckCounts()).toMatchObject({ found: 1 });
  });

  it("still replays the 404 to a plain Start — the negative cache keeps absorbing bursts", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult(["a"]));

    await expect(loadPlaylist(URL_A)).rejects.toMatchObject({ code: "playlist_not_found" });
    expect(upstreamCalls()).toBe(1);
  });

  it("replays a 404 only seconds old, so the button cannot become a burst", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    for (let i = 0; i < 5; i++) {
      await expect(loadPlaylist(URL_A, "playlist-api", { recheck: true })).rejects.toMatchObject({
        code: "playlist_not_found",
      });
    }
    expect(upstreamCalls()).toBe(1);
    // Spotify was never asked, so none of these say the playlist is still private.
    expect(recheckCounts()).toMatchObject({ replayed: 5, missing: 0 });
  });

  it("counts the page's own recheck apart from the button, and lets the host through", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult(["a"]));

    await expect(
      loadPlaylist(URL_A, "playlist-api", { recheck: true, automatic: true })
    ).resolves.toMatchObject({ totalTracks: 1 });
    expect(upstreamCalls()).toBe(2);
    expect(autocheckCounts()).toMatchObject({ found: 1 });
    expect(recheckCounts()).toMatchObject({ found: 0, missing: 0, replayed: 0 });
  });

  it.each(["spotify:cooldown", "spotify:budget:spent", "spotify:budget:near"])(
    "does not ask Spotify for the page's own recheck while %s is up",
    async (pressureKey) => {
      await expect(loadPlaylist(URL_A)).rejects.toThrow();
      vi.setSystemTime(new Date(Date.now() + 30_000));
      upstream().mockResolvedValue(upstreamResult(["a"]));
      kv.mem.set(pressureKey, {
        value: { until: Date.now() + 60 * 60_000 },
        expiresAt: Date.now() + 60 * 60_000,
      });

      await expect(
        loadPlaylist(URL_A, "playlist-api", { recheck: true, automatic: true })
      ).rejects.toMatchObject({ code: "playlist_not_found" });
      expect(upstreamCalls()).toBe(1);
      expect(autocheckCounts()).toMatchObject({ replayed: 1 });
    }
  );

  it("still lets the button through under pressure — that is the host asking", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult(["a"]));
    kv.mem.set("spotify:budget:near", {
      value: { until: Date.now() + 60 * 60_000 },
      expiresAt: Date.now() + 60 * 60_000,
    });
    await expect(loadPlaylist(URL_A, "playlist-api", { recheck: true })).resolves.toMatchObject({
      totalTracks: 1,
    });
  });

  it("does not ask Spotify for the page's own recheck under pressure once its 404 has expired", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 11 * 60_000));
    kv.mem.delete(`playlist:v1:${playlistId("a")}`);
    upstream().mockResolvedValue(upstreamResult(["a"]));
    kv.mem.set("spotify:budget:near", {
      value: { until: Date.now() + 60 * 60_000 },
      expiresAt: Date.now() + 60 * 60_000,
    });
    await expect(
      loadPlaylist(URL_A, "playlist-api", { recheck: true, automatic: true })
    ).rejects.toMatchObject({ code: "playlist_not_found" });
    expect(upstreamCalls()).toBe(1);
    expect(autocheckCounts()).toMatchObject({ replayed: 1 });
  });

  it("counts a recheck that loads an empty playlist as other, and the page's own as no refusal", async () => {
    const emptyRefused = () =>
      (kv.mem.get("loop:stats:2026-10-13:playlist_refused:playlist_empty")?.value as number) ?? 0;
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult([]));
    await expect(
      loadPlaylist(URL_A, "playlist-api", { recheck: true, automatic: true })
    ).resolves.toMatchObject({ totalTracks: 0 });
    expect(autocheckCounts()).toMatchObject({ found: 0, other: 1 });
    expect(emptyRefused()).toBe(0);
  });

  it("counts a too-young automatic recheck as the page's replayed, not the button's", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 5_000));
    await expect(
      loadPlaylist(URL_A, "playlist-api", { recheck: true, automatic: true })
    ).rejects.toMatchObject({ code: "playlist_not_found" });
    expect(upstreamCalls()).toBe(1);
    expect(autocheckCounts()).toMatchObject({ replayed: 1, missing: 0 });
    expect(recheckCounts()).toMatchObject({ replayed: 0, missing: 0 });
  });

  it("does not count the page's own refused recheck as another refusal", async () => {
    const refused = () =>
      (kv.mem.get("loop:stats:2026-10-13:playlist_refused:playlist_not_found")?.value as number) ?? 0;
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    expect(refused()).toBe(1);
    vi.setSystemTime(new Date(Date.now() + 30_000));
    await expect(
      loadPlaylist(URL_A, "playlist-api", { recheck: true, automatic: true })
    ).rejects.toMatchObject({ code: "playlist_not_found" });
    expect(upstreamCalls()).toBe(2);
    expect(autocheckCounts()).toMatchObject({ missing: 1 });
    // One person told their link is dead, once.
    expect(refused()).toBe(1);
  });

  it("asks Spotify again on a recheck after the wait, and counts a second refusal as missing", async () => {
    await expect(loadPlaylist(URL_A)).rejects.toThrow();
    vi.setSystemTime(new Date(Date.now() + 30_000));
    await expect(loadPlaylist(URL_A, "playlist-api", { recheck: true })).rejects.toMatchObject({
      code: "playlist_not_found",
    });
    expect(upstreamCalls()).toBe(2);
    expect(recheckCounts()).toMatchObject({ missing: 1, found: 0 });
  });

  it("takes only a literal true from the route", async () => {
    const post = (body: unknown) =>
      postPlaylist(
        new NextRequest("http://localhost/api/playlist", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
        })
      );
    await post({ url: URL_A });
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult(["a"]));

    expect((await post({ url: URL_A, recheck: "true" })).status).toBe(404);
    expect((await post({ url: URL_A, recheck: true })).status).toBe(200);
  });

  it("takes the page's own recheck as the literal \"auto\", and counts it as automatic", async () => {
    const post = (body: unknown) =>
      postPlaylist(
        new NextRequest("http://localhost/api/playlist", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.8" },
        })
      );
    await post({ url: URL_A });
    vi.setSystemTime(new Date(Date.now() + 30_000));
    upstream().mockResolvedValue(upstreamResult(["a"]));

    expect((await post({ url: URL_A, recheck: "AUTO" })).status).toBe(404);
    expect((await post({ url: URL_A, recheck: "auto" })).status).toBe(200);
    expect(autocheckCounts()).toMatchObject({ found: 1 });
  });

  it("marks a recheck the cache answered without asking Spotify, and only that one", async () => {
    const post = (body: unknown) =>
      postPlaylist(
        new NextRequest("http://localhost/api/playlist", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.7" },
        })
      );
    // The first refusal is Spotify's: no mark.
    const first = await post({ url: URL_A });
    expect(first.status).toBe(404);
    expect((await first.json()).replayed).toBeUndefined();
    // A recheck seconds later is our cached 404: marked.
    const replayed = await post({ url: URL_A, recheck: true });
    expect(replayed.status).toBe(404);
    expect(await replayed.json()).toMatchObject({ code: "playlist_not_found", replayed: true });
    // Past the wait Spotify is asked again and says 404 itself: no mark.
    vi.setSystemTime(new Date(Date.now() + 30_000));
    const asked = await post({ url: URL_A, recheck: true });
    expect(asked.status).toBe(404);
    expect((await asked.json()).replayed).toBeUndefined();
  });
});
