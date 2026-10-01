// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as share } from "@/app/share/route";
import { resolveShortlink } from "@/lib/spotify-shortlink";
import { shareDestination } from "@/lib/share-target";
import { __resetLivenessForTests } from "@/lib/loop-stats";

/**
 * Nothing here reaches `spotify.link`: `fetch` is a stub for the whole file.
 * What is asserted is mostly *which requests were made* — the resolver's
 * promises are about where it will and will not send one, and how often.
 */

const kv = vi.hoisted(() => {
  const mem = new Map<string, { value: unknown; expiresAt: number }>();
  const writes: Array<{ key: string; value: unknown; ttlSeconds: number }> = [];
  const flags = { failReads: false, failWrites: false };
  return { mem, writes, flags };
});

vi.mock("@/lib/kv", () => ({
  dayBucket: (at: Date = new Date()) => at.toISOString().slice(0, 10),
  hourBucket: (at: Date = new Date()) => at.toISOString().slice(0, 13),
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
    async incr(key: string, ttlSeconds: number) {
      if (kv.flags.failWrites) throw new Error("kv unavailable");
      const entry = kv.mem.get(key);
      const next = ((entry?.value as number | undefined) ?? 0) + 1;
      kv.mem.set(key, { value: next, expiresAt: Date.now() + ttlSeconds * 1000 });
      return next;
    },
  }),
}));

const ID = "3cEYpjA9oz9GiPac4AsH4n";
const SHORT = "https://spotify.link/AbCdEfG";
const PLAYLIST = `https://open.spotify.com/playlist/${ID}?si=abc&_branch_match_id=1`;

type Reply = { status: number; location?: string; html?: string } | Error;

/**
 * Branch's interstitial, trimmed from what `spotify.app.link` answered a
 * live playlist short link on 2026-10-01 when asked with Node's default
 * `User-Agent: node` — the page every production short link landed on. The
 * destination is in an "open in browser" anchor and in the script's
 * `window.top.location = validateProtocol(…)`; the app's own `spotify://`
 * address is beside them.
 */
const branchPage = (target: string) => `<!DOCTYPE html>
<html>
	<head>
		<meta name="deepview-service" content="deepview-service">
		<style>.card--no-data { display: flex; }</style>
	</head>
	<body>
		<div class="heading">Launching Spotify</div>
		<div class="sub-heading">
			We have redirected you to the desktop app.
			You can also <a class="secondary-action" href="${target}">open this link in your browser.</a>
		</div>
		<a class="action" href="spotify://playlist/${ID}?_branch_referrer=H4sIAAAA&link_click_id=1634193397790090417">Launch Spotify</a>
	<script type="text/javascript">
function validateProtocol(url){
   var parser = document.createElement("a");
   parser.href = url;
   return url;
}
        window.onload = function() {
          window.top.location = validateProtocol("spotify://playlist/${ID}?link_click_id=1634193397790090417");
          setTimeout(function timeout() {
            if (!hasURI) {
              window.top.location = validateProtocol("${target}");
            }
          }, 500);
        };</script></body>
</html>`;

const INTERSTITIAL = branchPage(
  `https://open.spotify.com/playlist/${ID}?si=s1MRgeESTQ2OK4Rn-xpXtw&pi=a-rG9J6UAVS9-1&_branch_match_id=1634193397790090417&utm_source=copy-link&utm_medium=sharing`
);

/**
 * What the same hosts answered for a short link that names nothing any
 * more (`spotify.link/h5TbcGLLkhb`, 2026-10-01): the same page, sending the
 * browser to the app store. Nothing in it is a Spotify address.
 */
const DEAD_LINK_PAGE = branchPage(
  "https://apps.apple.com/us/app/spotify-discover-new-music/id324684580?_branch_match_id=1634193401736822629&utm_source=Web"
);

/** The first hop Node's default User-Agent got from `spotify.link`. */
const TO_APP_LINK = {
  status: 307,
  location: "https://spotify.app.link/AbCdEfG?_p=c11037dc990366eee0188de3eab1bd",
};

/** Answers each request from a script, in order, and records what was asked. */
function stubFetch(...replies: Reply[]) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const queue = [...replies];
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const reply = queue.shift();
    if (!reply) throw new Error(`unscripted request to ${String(url)}`);
    if (reply instanceof Error) throw reply;
    const headers: Record<string, string> = {};
    if (reply.location) headers.location = reply.location;
    if (reply.html !== undefined) headers["content-type"] = "text/html; charset=utf-8";
    return new Response(reply.html ?? null, { status: reply.status, headers });
  });
  vi.stubGlobal("fetch", mock);
  return { requests, calls: () => mock.mock.calls.length };
}

const day = () => new Date().toISOString().slice(0, 10);
const counted = (outcome: string) =>
  (kv.mem.get(`loop:stats:${day()}:playlist_shortlink:${outcome}`)?.value as number | undefined) ?? 0;
const cacheWrites = () => kv.writes.filter((w) => w.key.startsWith("shortlink:"));

beforeEach(() => {
  kv.mem.clear();
  kv.writes.length = 0;
  kv.flags.failReads = false;
  kv.flags.failWrites = false;
  __resetLivenessForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("following a short link", () => {
  it("reads the playlist off the redirect", async () => {
    const net = stubFetch({ status: 307, location: PLAYLIST });

    await expect(resolveShortlink(SHORT)).resolves.toEqual({
      status: "resolved",
      link: { kind: "playlist", id: ID },
    });
    expect(net.calls()).toBe(1);
    expect(net.requests[0].url).toBe(SHORT);
  });

  it("does not follow the redirect itself, and gives up on a deadline", async () => {
    // `follow` would download the playlist's whole web page to learn an
    // address the redirect already spelled out — and would go wherever the
    // chain led. There was no timeout at all before this.
    const net = stubFetch({ status: 307, location: PLAYLIST });
    await resolveShortlink(SHORT);

    const { init } = net.requests[0];
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // Next's fetch cache must not hold a redirector's answer on our behalf.
    expect(init?.cache).toBe("no-store");
  });

  it("names an album, a track and an artist for what they are", async () => {
    for (const kind of ["album", "track", "artist"] as const) {
      kv.mem.clear();
      stubFetch({ status: 302, location: `https://open.spotify.com/intl-ja/${kind}/${ID}?si=x` });
      await expect(resolveShortlink(SHORT)).resolves.toEqual({
        status: "resolved",
        link: { kind },
      });
    }
  });

  it("requests the address the classifier rebuilt, not the text it was handed", async () => {
    const net = stubFetch({ status: 307, location: PLAYLIST });
    await resolveShortlink("look: HTTP://Spotify.Link/AbCdEfG?x=1#frag and more");
    expect(net.requests[0].url).toBe(SHORT);
  });
});

describe("the host is matched before any request is made", () => {
  it("makes no request for anything that is not a short link", async () => {
    const net = stubFetch();
    for (const url of [
      "https://example.com/AbCdEfG",
      "https://spotify.link.example.com/AbCdEfG",
      "https://notspotify.link/AbCdEfG",
      "http://169.254.169.254/latest/meta-data",
      `https://open.spotify.com/playlist/${ID}`,
      "",
    ]) {
      await expect(resolveShortlink(url), url).resolves.toEqual({ status: "unusable" });
    }
    expect(net.calls()).toBe(0);
    // Nothing was followed, so nothing is counted and nothing is stored.
    expect(counted("unusable")).toBe(0);
    expect(cacheWrites()).toEqual([]);
  });

  it("never lets a redirect aim it at a host of the redirect's choosing", async () => {
    // Each of these is classified as text and answered; none is fetched.
    for (const location of [
      `https://evil.example/playlist/${ID}`,
      "https://evil.example/",
      "http://169.254.169.254/latest/meta-data",
      "http://spotify.link/AbCdEfG", // plain http is not followed either
      "https://someone@spotify.link/AbCdEfG", // any userinfo is refused
      "https://spotify.link:8443/AbCdEfG",
      "javascript:alert(1)",
    ]) {
      kv.mem.clear();
      const net = stubFetch({ status: 302, location });
      await expect(resolveShortlink(SHORT), location).resolves.toEqual({ status: "unusable" });
      expect(net.calls(), location).toBe(1);
    }
  });

  it("follows a hop between Spotify's own short-link hosts, as it was written", async () => {
    const net = stubFetch(
      { status: 302, location: "https://spotify.app.link/AbCdEfG?_p=c11" },
      { status: 307, location: PLAYLIST }
    );
    await expect(resolveShortlink(SHORT)).resolves.toMatchObject({ status: "resolved" });
    expect(net.requests.map((r) => r.url)).toEqual([SHORT, "https://spotify.app.link/AbCdEfG?_p=c11"]);
  });

  it("stops at three hops when a redirector points at itself", async () => {
    const loop = { status: 302, location: "https://spotify.link/AbCdEfG?again=1" };
    const net = stubFetch(loop, loop, loop, loop, loop);
    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
    expect(net.calls()).toBe(3);
  });
});

describe("Branch's interstitial, which is what production actually got", () => {
  it("names itself so Branch answers with a redirect rather than a page", async () => {
    // Node's default `User-Agent: node` is read as a browser and handed the
    // interstitial; named as a crawler, the link is one 307 to the playlist.
    const net = stubFetch(TO_APP_LINK, { status: 307, location: PLAYLIST });
    await resolveShortlink(SHORT);
    expect(net.calls()).toBe(2);
    for (const { init } of net.requests) {
      const ua = new Headers(init?.headers).get("user-agent") ?? "";
      expect(ua).toMatch(/bot/i);
      expect(ua).toContain("guessong.app");
    }
  });

  it("reads the destination off the page, after the hop to spotify.app.link", async () => {
    // The exact sequence the six production short links went through.
    const net = stubFetch(TO_APP_LINK, { status: 200, html: INTERSTITIAL });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({
      status: "resolved",
      link: { kind: "playlist", id: ID },
    });
    expect(net.calls()).toBe(2);
    expect(cacheWrites()).toHaveLength(1);
    expect(counted("resolved")).toBe(1);
  });

  it("reads an album off the page as an album", async () => {
    stubFetch({ status: 200, html: branchPage(`https://open.spotify.com/album/${ID}?si=x`) });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({
      status: "resolved",
      link: { kind: "album" },
    });
  });

  it("calls a page that names no Spotify address unavailable, never unusable", async () => {
    // A dead link's page and a page whose markup moved look the same to
    // this reader; only a clean reply may produce the permanent answer.
    for (const html of [DEAD_LINK_PAGE, "<html><body>Launching Spotify</body></html>", ""]) {
      kv.mem.clear();
      kv.writes.length = 0;
      stubFetch(TO_APP_LINK, { status: 200, html });
      await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
      expect(cacheWrites()).toEqual([]);
    }
  });

  it("calls a page naming two different things unavailable", async () => {
    const other = "4aBcDeFgHiJkLmNoPqRsTu";
    const html = INTERSTITIAL + `<a href="https://open.spotify.com/playlist/${other}">another</a>`;
    stubFetch({ status: 200, html });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
  });

  it("ignores a page's links to things that are not music", async () => {
    const html = `<a href="https://open.spotify.com/">home</a>` + INTERSTITIAL;
    stubFetch({ status: 200, html });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({
      status: "resolved",
      link: { kind: "playlist", id: ID },
    });
  });

  it("reads only so far into a page", async () => {
    // A destination past the cap is not read: the redirector does not get
    // to make us download whatever it likes.
    const html = "<!--" + "x".repeat(70 * 1024) + "-->" + INTERSTITIAL;
    stubFetch({ status: 200, html });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
  });

  it("does not read a 200 that is not a page", async () => {
    stubFetch({ status: 200 });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
  });
});

describe("unusable is a fact about the link, unavailable is a fact about us", () => {
  it("calls a link the redirector does not know unusable", async () => {
    for (const status of [404, 410]) {
      kv.mem.clear();
      stubFetch({ status });
      await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unusable" });
    }
  });

  it("calls a link to something that is not music unusable", async () => {
    for (const location of [
      `https://open.spotify.com/episode/${ID}`,
      `https://open.spotify.com/show/${ID}`,
      "https://open.spotify.com/user/someone",
      "https://open.spotify.com/",
      "https://www.spotify.com/download",
    ]) {
      kv.mem.clear();
      stubFetch({ status: 307, location });
      await expect(resolveShortlink(SHORT), location).resolves.toEqual({ status: "unusable" });
    }
  });

  it("calls everything it could not read unavailable, so the host may ask again", async () => {
    // Only a clean reply may produce a permanent answer. A wrong
    // `unavailable` costs one retry; a wrong `unusable` tells a host their
    // working link is broken and stops their Start button from asking.
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const replies: Reply[] = [
      timeout,
      new TypeError("fetch failed"),
      { status: 200 }, // a 200 that is not a page
      { status: 403 },
      { status: 429 },
      { status: 500 },
      { status: 503 },
      { status: 302 }, // a redirect to nowhere
    ];
    for (const reply of replies) {
      kv.mem.clear();
      kv.writes.length = 0;
      stubFetch(reply);
      await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
      expect(cacheWrites()).toEqual([]);
    }
  });

  it("never throws, whatever the network does", async () => {
    stubFetch(new Error("anything at all"));
    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
  });
});

describe("the cache", () => {
  it("holds a followed link for a day, so a retried one is not fetched again", async () => {
    const net = stubFetch({ status: 307, location: PLAYLIST });

    const first = await resolveShortlink(SHORT);
    const second = await resolveShortlink(SHORT);
    const third = await resolveShortlink("  https://SPOTIFY.LINK/AbCdEfG?si=other  ");

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(net.calls()).toBe(1);
    expect(cacheWrites()).toHaveLength(1);
    expect(cacheWrites()[0].ttlSeconds).toBe(24 * 60 * 60);
  });

  it("keys on the slug's exact case — it is case-sensitive upstream", async () => {
    const net = stubFetch(
      { status: 307, location: PLAYLIST },
      { status: 307, location: `https://open.spotify.com/album/${ID}` }
    );
    await expect(resolveShortlink("https://spotify.link/AbCdEfG")).resolves.toMatchObject({
      link: { kind: "playlist" },
    });
    await expect(resolveShortlink("https://spotify.link/abcdefg")).resolves.toMatchObject({
      link: { kind: "album" },
    });
    expect(net.calls()).toBe(2);
  });

  it("holds a refusal for ten minutes — long enough for the retries, short enough to be wrong", async () => {
    const net = stubFetch({ status: 404 });
    await resolveShortlink(SHORT);
    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unusable" });

    expect(net.calls()).toBe(1);
    expect(cacheWrites()[0].ttlSeconds).toBe(10 * 60);
  });

  it("does not remember a failure to get through", async () => {
    const net = stubFetch(new TypeError("fetch failed"), { status: 307, location: PLAYLIST });

    await expect(resolveShortlink(SHORT)).resolves.toEqual({ status: "unavailable" });
    // The very next attempt goes out, and works.
    await expect(resolveShortlink(SHORT)).resolves.toMatchObject({ status: "resolved" });
    expect(net.calls()).toBe(2);
  });

  it("fails open when KV cannot be read: the link is simply followed", async () => {
    kv.flags.failReads = true;
    const net = stubFetch({ status: 307, location: PLAYLIST }, { status: 307, location: PLAYLIST });

    await expect(resolveShortlink(SHORT)).resolves.toMatchObject({ status: "resolved" });
    await expect(resolveShortlink(SHORT)).resolves.toMatchObject({ status: "resolved" });
    expect(net.calls()).toBe(2);
  });

  it("still answers when KV cannot be written", async () => {
    kv.flags.failWrites = true;
    stubFetch({ status: 307, location: PLAYLIST });
    await expect(resolveShortlink(SHORT)).resolves.toEqual({
      status: "resolved",
      link: { kind: "playlist", id: ID },
    });
  });

  it("ignores an entry that is not one of the two shapes it writes", async () => {
    // What comes back is handed to the playlist path as a playlist id, so a
    // value that merely looks like an answer must not be taken for one.
    const key = "shortlink:v1:spotify.link/AbCdEfG";
    for (const poisoned of [
      "resolved",
      { status: "resolved" },
      { status: "resolved", link: { kind: "playlist", id: "../../etc" } },
      { status: "resolved", link: { kind: "playlist", id: "short" } },
      { status: "resolved", link: { kind: "shortlink", url: "https://spotify.link/x" } },
      { status: "unavailable" },
      42,
    ]) {
      kv.mem.clear();
      kv.mem.set(key, { value: poisoned, expiresAt: Date.now() + 60_000 });
      const net = stubFetch({ status: 307, location: PLAYLIST });
      await expect(resolveShortlink(SHORT), JSON.stringify(poisoned)).resolves.toEqual({
        status: "resolved",
        link: { kind: "playlist", id: ID },
      });
      expect(net.calls()).toBe(1);
    }
  });
});

describe("every short link is counted by how it came out", () => {
  it("counts each outcome under its own key, a cached answer included", async () => {
    stubFetch({ status: 307, location: PLAYLIST });
    await resolveShortlink(SHORT);
    await resolveShortlink(SHORT); // from cache — still an attempt
    expect(counted("resolved")).toBe(2);

    stubFetch({ status: 404 });
    await resolveShortlink("https://spotify.link/DeadSlug");
    expect(counted("unusable")).toBe(1);

    stubFetch(new TypeError("fetch failed"));
    await resolveShortlink("https://spotify.link/Stalled");
    expect(counted("unavailable")).toBe(1);

    expect(counted("resolved")).toBe(2);
  });

  it("counts a link that led to an album as followed — it was", async () => {
    stubFetch({ status: 307, location: `https://open.spotify.com/album/${ID}` });
    await resolveShortlink(SHORT);
    expect(counted("resolved")).toBe(1);
    expect(counted("unusable")).toBe(0);
  });
});

describe("where a share lands", () => {
  it("sends a playlist to the setup page by its one address", async () => {
    const net = stubFetch();
    await expect(
      shareDestination(`來聽聽這個歌單！ https://open.spotify.com/intl-zh-tw/playlist/${ID}?si=x`)
    ).resolves.toEqual({ to: "setup", playlistUrl: `https://open.spotify.com/playlist/${ID}` });
    expect(net.calls()).toBe(0);
  });

  it("follows a shared short link to its playlist", async () => {
    stubFetch({ status: 307, location: PLAYLIST });
    await expect(shareDestination(`Check this out ${SHORT}`)).resolves.toEqual({
      to: "setup",
      playlistUrl: `https://open.spotify.com/playlist/${ID}`,
    });
  });

  it("says what was shared when it was not a playlist", async () => {
    const net = stubFetch();
    for (const type of ["track", "album", "artist"] as const) {
      await expect(shareDestination(`https://open.spotify.com/${type}/${ID}`)).resolves.toEqual({
        to: "unsupported",
        type,
      });
    }
    await expect(shareDestination("just some words")).resolves.toEqual({
      to: "unsupported",
      type: "unknown",
    });
    expect(net.calls()).toBe(0);

    stubFetch({ status: 307, location: `https://open.spotify.com/album/${ID}` });
    await expect(shareDestination(SHORT)).resolves.toEqual({ to: "unsupported", type: "album" });
  });

  it("sends a dead short link to the explanation", async () => {
    stubFetch({ status: 404 });
    await expect(shareDestination(SHORT)).resolves.toEqual({ to: "unsupported", type: "unknown" });
  });

  it("hands on a short link it could not follow, rather than calling it not a playlist", async () => {
    // Nothing was learned about the link. The form takes a short link and
    // the server follows it again on Start, so the share is delayed, not lost.
    stubFetch(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(shareDestination(SHORT)).resolves.toEqual({ to: "setup", playlistUrl: SHORT });
  });

  it("hands on a short link unfollowed when the limiter has refused the address", async () => {
    const net = stubFetch();
    await expect(shareDestination(`${SHORT}?si=x`, { mayResolve: false })).resolves.toEqual({
      to: "setup",
      playlistUrl: SHORT,
    });
    expect(net.calls()).toBe(0);
    // A refusal only ever withholds the request. A playlist costs none.
    await expect(
      shareDestination(`https://open.spotify.com/playlist/${ID}`, { mayResolve: false })
    ).resolves.toEqual({ to: "setup", playlistUrl: `https://open.spotify.com/playlist/${ID}` });
  });
});

describe("/share", () => {
  const ORIGIN = "https://www.guessong.app";

  /** The share sheet's GET, from one address. Android fills `text`, mostly. */
  function shared(params: Record<string, string>, ip = "203.0.113.7"): NextRequest {
    return new NextRequest(`${ORIGIN}/share?${new URLSearchParams(params)}`, {
      headers: { "x-forwarded-for": ip },
    });
  }

  async function landing(req: NextRequest): Promise<URL> {
    const res = await share(req);
    // Every branch is a navigation. A JSON body here would be the person
    // looking at a response instead of a page.
    expect(res.status).toBe(302);
    return new URL(res.headers.get("location") ?? "", ORIGIN);
  }

  it("lands a shared playlist on the setup page, prefilled", async () => {
    const net = stubFetch();
    const to = await landing(
      shared({ title: "My mix", text: `Listen: https://open.spotify.com/playlist/${ID}?si=x` })
    );
    expect(to.pathname).toBe("/");
    expect(to.searchParams.get("playlist")).toBe(`https://open.spotify.com/playlist/${ID}`);
    expect(to.searchParams.get("utm_source")).toBe("share_target");
    expect(net.calls()).toBe(0);
  });

  it("follows a shared short link, and says what it was when it was not a playlist", async () => {
    stubFetch({ status: 307, location: PLAYLIST });
    const playlist = await landing(shared({ url: SHORT }));
    expect(playlist.searchParams.get("playlist")).toBe(`https://open.spotify.com/playlist/${ID}`);

    stubFetch({ status: 307, location: `https://open.spotify.com/album/${ID}` });
    const album = await landing(shared({ url: "https://spotify.link/AnAlbum" }));
    expect(album.pathname).toBe("/share/unsupported");
    expect(album.searchParams.get("type")).toBe("album");
  });

  it("explains a share with no playlist in it", async () => {
    const to = await landing(shared({ text: "just some words" }));
    expect(to.pathname).toBe("/share/unsupported");
    expect(to.searchParams.get("type")).toBe("unknown");
  });

  it("stops following short links for an address that has asked too often", async () => {
    // The one branch that makes a request and writes a key, on a GET anyone
    // can call: without a limit, `/share?url=spotify.link/<random>` fills KV
    // a slug at a time.
    const replies = Array.from({ length: 40 }, () => ({ status: 307, location: PLAYLIST }));
    const net = stubFetch(...replies);

    for (let i = 0; i < 20; i += 1) {
      await landing(shared({ url: `https://spotify.link/Slug${i}` }));
    }
    expect(net.calls()).toBe(20);

    // Past the limit the link is handed on as it is. The setup page takes a
    // short link and the server follows it on Start, under its own limiter —
    // so the person still arrives somewhere that works.
    const refused = await landing(shared({ url: "https://spotify.link/OneTooMany" }));
    expect(net.calls()).toBe(20);
    expect(refused.pathname).toBe("/");
    expect(refused.searchParams.get("playlist")).toBe("https://spotify.link/OneTooMany");
    expect([...kv.mem.keys()].some((k) => k.includes("OneTooMany"))).toBe(false);

    // Another address is not held to this one's count.
    await landing(shared({ url: "https://spotify.link/Elsewhere" }, "198.51.100.9"));
    expect(net.calls()).toBe(21);
  });

  it("never counts a plain playlist against the limit — it costs nothing", async () => {
    const net = stubFetch();
    for (let i = 0; i < 30; i += 1) {
      const to = await landing(shared({ url: `https://open.spotify.com/playlist/${ID}` }));
      expect(to.pathname).toBe("/");
    }
    expect(net.calls()).toBe(0);
    expect([...kv.mem.keys()].some((k) => k.startsWith("ratelimit:"))).toBe(false);
  });

  it("still lands the share when KV is down", async () => {
    kv.flags.failReads = true;
    kv.flags.failWrites = true;
    stubFetch({ status: 307, location: PLAYLIST });
    const to = await landing(shared({ url: SHORT }));
    expect(to.searchParams.get("playlist")).toBe(`https://open.spotify.com/playlist/${ID}`);
  });
});
