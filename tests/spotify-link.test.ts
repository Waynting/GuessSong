import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAMED_LINK_CODES,
  SPOTIFY_SHORTLINK_HOSTS,
  checkPlaylistLink,
  classifySpotifyLink,
  isEditorialPlaylistId,
  isEditorialPlaylistLink,
  isSpotifyShortlinkHost,
  isSubmittablePlaylistLink,
  playlistIdFromLink,
  playlistUrlFromId,
} from "@/lib/spotify-link";
import { isSpotifyEditorial, parsePlaylistUrl } from "@/lib/spotify";
import { parseSharedText } from "@/lib/share-target";
import { ERROR_MESSAGES, isAppErrorCode, isDeterministicPlaylistFailure } from "@/lib/error-messages";

const ID = "3cEYpjA9oz9GiPac4AsH4n"; // 22 base62 characters
const EDITORIAL = "37i9dQZF1DXcBWIGoYBM5M";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
/** Source with its comments removed, so a rule can be quoted in prose. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("what the server has always loaded still loads", () => {
  // Every shape here reached the old unanchored regex and produced a game.
  // The classifier is stricter about hosts and ids, and none of that
  // strictness may cost a link that was working.
  const accepted: Array<[string, string]> = [
    ["the plain web link", `https://open.spotify.com/playlist/${ID}`],
    ["a ?si= share token", `https://open.spotify.com/playlist/${ID}?si=abc123def456`],
    ["any other query string", `https://open.spotify.com/playlist/${ID}?utm_source=copy&nd=1`],
    ["a fragment", `https://open.spotify.com/playlist/${ID}#top`],
    ["a trailing slash", `https://open.spotify.com/playlist/${ID}/`],
    ["a locale prefix", `https://open.spotify.com/intl-ja/playlist/${ID}`],
    ["a regional locale prefix", `https://open.spotify.com/intl-zh-tw/playlist/${ID}?si=x`],
    ["the pre-2018 user path", `https://open.spotify.com/user/spotify_taiwan/playlist/${ID}`],
    ["a user path with an encoded name", `https://open.spotify.com/user/j%C3%B8rgen.b/playlist/${ID}`],
    ["the embed player", `https://open.spotify.com/embed/playlist/${ID}`],
    ["the old web player's host", `https://play.spotify.com/user/someone/playlist/${ID}`],
    ["no scheme", `open.spotify.com/playlist/${ID}`],
    ["plain http", `http://open.spotify.com/playlist/${ID}`],
    ["a keyboard that capitalised it", `Https://Open.Spotify.com/playlist/${ID}`],
    ["the URI", `spotify:playlist:${ID}`],
    ["the pre-2018 URI", `spotify:user:someone:playlist:${ID}`],
    ["whitespace around it", `  \n https://open.spotify.com/playlist/${ID}?si=x \t`],
    ["a sentence around it", `來聽聽這個歌單！ https://open.spotify.com/playlist/${ID}?si=x 超讚`],
    ["a link wrapped by a redirector", `https://l.example.com/?u=https://open.spotify.com/playlist/${ID}&h=1`],
  ];

  for (const [name, pasted] of accepted) {
    it(`reads ${name}`, () => {
      expect(classifySpotifyLink(pasted)).toEqual({ kind: "playlist", id: ID });
      expect(isSubmittablePlaylistLink(pasted)).toBe(true);
    });
  }

  it("keeps the id's case, which is part of the id", () => {
    const mixed = "aBcDeFgHiJkLmNoPqRsTuV";
    expect(playlistIdFromLink(`HTTPS://OPEN.SPOTIFY.COM/playlist/${mixed}`)).toBe(mixed);
  });
});

describe("an id is 22 base62 characters, and not one more", () => {
  // A malformed id used to go upstream to be told it was nothing: one call
  // against a quota every visitor shares, answered with a 400 that is neither
  // cached nor deterministic, so each retry spent another.
  it("refuses an id that is too short", () => {
    expect(classifySpotifyLink("https://open.spotify.com/playlist/abc123")).toEqual({ kind: "unknown" });
    expect(classifySpotifyLink(`https://open.spotify.com/playlist/${ID.slice(0, 21)}`)).toEqual({
      kind: "unknown",
    });
  });

  it("refuses an id that runs on, rather than reading its first 22", () => {
    // The first 22 characters of a 23-character id are somebody else's
    // playlist, or nobody's. Loading them would be a wrong answer, not a lenient one.
    expect(classifySpotifyLink(`https://open.spotify.com/playlist/${ID}x`)).toEqual({ kind: "unknown" });
    expect(classifySpotifyLink(`spotify:playlist:${ID}0`)).toEqual({ kind: "unknown" });
  });

  it("refuses characters that are not base62", () => {
    expect(classifySpotifyLink("https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4As-4n")).toEqual({
      kind: "unknown",
    });
  });

  it("refuses a bare id — nothing says it is a playlist's", () => {
    // Tracks, albums and artists are 22 base62 characters too.
    expect(classifySpotifyLink(ID)).toEqual({ kind: "unknown" });
  });
});

describe("the host is checked, because the path alone proves nothing", () => {
  it("refuses a playlist path on somebody else's site", () => {
    for (const pasted of [
      `https://example.com/playlist/${ID}`,
      `https://open.spotify.com.example.com/playlist/${ID}`,
      `https://notopen.spotify.com/playlist/${ID}`,
      `https://fake-open.spotify.com/playlist/${ID}`,
      `https://music.apple.com/playlist/${ID}`,
    ]) {
      expect(classifySpotifyLink(pasted), pasted).toEqual({ kind: "unknown" });
    }
  });

  it("refuses a short link on a host that only ends like Spotify's", () => {
    for (const pasted of [
      "https://notspotify.link/AbCdEfG",
      "https://spotify.link.example.com/AbCdEfG",
      "https://open.spotify.link/AbCdEfG",
      "https://spotify.links/AbCdEfG",
    ]) {
      expect(classifySpotifyLink(pasted), pasted).toEqual({ kind: "unknown" });
    }
  });
});

describe("short links", () => {
  it("recognises each of Spotify's short-link hosts", () => {
    expect(classifySpotifyLink("https://spotify.link/AbCdEfG")).toEqual({
      kind: "shortlink",
      url: "https://spotify.link/AbCdEfG",
    });
    expect(classifySpotifyLink("https://spotify.app.link/AbCdEfG")).toEqual({
      kind: "shortlink",
      url: "https://spotify.app.link/AbCdEfG",
    });
    for (const host of SPOTIFY_SHORTLINK_HOSTS) {
      expect(isSpotifyShortlinkHost(host)).toBe(true);
      expect(isSpotifyShortlinkHost(host.toUpperCase())).toBe(true);
    }
    expect(isSpotifyShortlinkHost("open.spotify.com")).toBe(false);
    expect(isSpotifyShortlinkHost("evil.spotify.link")).toBe(false);
  });

  it("rebuilds the address rather than passing the paste along", () => {
    // What lib/spotify-shortlink.ts requests is this string. Query, fragment,
    // credentials and anything after the slug never reach it; the host is
    // lower-cased and the slug keeps its case.
    expect(classifySpotifyLink("see HTTP://Spotify.Link/AbC-d_9?si=x#y ok")).toEqual({
      kind: "shortlink",
      url: "https://spotify.link/AbC-d_9",
    });
    expect(classifySpotifyLink("spotify.link/AbCdEfG/../../etc")).toEqual({
      kind: "shortlink",
      url: "https://spotify.link/AbCdEfG",
    });
  });

  it("is submittable, because the server follows it and the page cannot", () => {
    expect(isSubmittablePlaylistLink("https://spotify.link/AbCdEfG")).toBe(true);
    expect(checkPlaylistLink("https://spotify.link/AbCdEfG")).toEqual({
      submittable: true,
      problem: null,
      named: null,
    });
  });

  it("is never read as a playlist id without being followed", () => {
    expect(playlistIdFromLink("https://spotify.link/AbCdEfG")).toBeNull();
    expect(parsePlaylistUrl("https://spotify.link/AbCdEfG")).toBeNull();
  });
});

describe("links to the wrong thing are named", () => {
  const named: Array<["album" | "track" | "artist", string[]]> = [
    [
      "album",
      [
        `https://open.spotify.com/album/${ID}`,
        `https://open.spotify.com/intl-ja/album/${ID}?si=x`,
        `spotify:album:${ID}`,
      ],
    ],
    [
      "track",
      [
        `https://open.spotify.com/track/${ID}?si=y`,
        `https://open.spotify.com/intl-de/track/${ID}`,
        `spotify:track:${ID}`,
      ],
    ],
    [
      "artist",
      [`https://open.spotify.com/artist/${ID}`, `spotify:artist:${ID}`],
    ],
  ];

  for (const [kind, links] of named) {
    it(`calls ${kind === "artist" || kind === "album" ? "an" : "a"} ${kind} link ${kind}`, () => {
      for (const pasted of links) {
        expect(classifySpotifyLink(pasted), pasted).toEqual({ kind });
        expect(isSubmittablePlaylistLink(pasted), pasted).toBe(false);
        expect(checkPlaylistLink(pasted), pasted).toEqual({
          submittable: false,
          problem: NAMED_LINK_CODES[kind],
          named: kind,
        });
      }
    });
  }

  it("maps every named kind to a code that exists, is final, and has both languages", () => {
    for (const named of Object.values(NAMED_LINK_CODES)) {
      expect(isAppErrorCode(named)).toBe(true);
      // The server throws these and the setup page remembers them; an album
      // does not become a playlist on the second press.
      expect(isDeterministicPlaylistFailure(named)).toBe(true);
      expect(ERROR_MESSAGES[named].en).not.toBe(ERROR_MESSAGES[named].zh);
    }
  });

  it("holds a named link to the same id rule as a playlist", () => {
    // `…/album/abc` is not an album link, it is a broken one.
    expect(classifySpotifyLink("https://open.spotify.com/album/abc")).toEqual({ kind: "unknown" });
  });
});

describe("the order, when a paste holds more than one link", () => {
  it("takes the playlist over everything beside it", () => {
    expect(
      classifySpotifyLink(
        `https://open.spotify.com/track/${ID} from https://open.spotify.com/playlist/${EDITORIAL} via https://spotify.link/AbCdEfG`
      )
    ).toEqual({ kind: "playlist", id: EDITORIAL });
  });

  it("takes a short link over a link that certainly is not a playlist", () => {
    // The short link may be one. It has to be followed to find out.
    expect(
      classifySpotifyLink(`https://open.spotify.com/album/${ID} https://spotify.link/AbCdEfG`)
    ).toEqual({ kind: "shortlink", url: "https://spotify.link/AbCdEfG" });
  });
});

describe("everything else is unknown", () => {
  it("says so for text, blanks and things that are not strings", () => {
    for (const pasted of ["just some words", "", "   ", "https://", "open.spotify.com", "spotify:playlist:"]) {
      expect(classifySpotifyLink(pasted), JSON.stringify(pasted)).toEqual({ kind: "unknown" });
    }
    for (const value of [undefined, null, 42, {}, ["https://open.spotify.com/playlist/" + ID]]) {
      expect(classifySpotifyLink(value)).toEqual({ kind: "unknown" });
      expect(isSubmittablePlaylistLink(value)).toBe(false);
    }
  });

  it("says so for Spotify links that are none of the four", () => {
    for (const pasted of [
      `https://open.spotify.com/episode/${ID}`,
      `https://open.spotify.com/show/${ID}`,
      "https://open.spotify.com/user/someone",
      "https://open.spotify.com/",
      "https://www.spotify.com/download",
    ]) {
      expect(classifySpotifyLink(pasted), pasted).toEqual({ kind: "unknown" });
    }
  });

  it("stays linear on a paste built to be slow", () => {
    // The input is unauthenticated and reaches three routes. The cap and the
    // bounded quantifiers are what this measures; a generous ceiling, because
    // the failure it guards against is seconds, not milliseconds.
    const hostile = [
      "open.spotify.com/user/" + "a".repeat(200_000),
      "spotify:user:" + ":".repeat(200_000),
      "/".repeat(200_000) + `open.spotify.com/playlist/${ID}`,
      ("open.spotify.com/intl-" + "-".repeat(40)).repeat(5_000),
    ];
    for (const pasted of hostile) {
      const started = performance.now();
      classifySpotifyLink(pasted);
      expect(performance.now() - started).toBeLessThan(100);
    }
  });

  it("reads only the head of a very long paste", () => {
    // A link with its share text is a couple of hundred characters. One that
    // sits past the cap is not read, which is the cap doing its job.
    expect(classifySpotifyLink(" ".repeat(5_000) + `https://open.spotify.com/playlist/${ID}`)).toEqual({
      kind: "unknown",
    });
  });
});

describe("what a field says about its contents", () => {
  it("says nothing about a blank field — it is not a mistake yet", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      expect(checkPlaylistLink(blank)).toEqual({ submittable: false, problem: null, named: null });
    }
  });

  it("never leaves a disabled button without its reason", () => {
    // The bug this replaced: a greyed-out button and no sentence. For any
    // non-blank value, either it can be sent or there is a code to render.
    for (const pasted of [
      "my party mix",
      "https://open.spotify.com/playlist/abc",
      `https://open.spotify.com/album/${ID}`,
      `https://open.spotify.com/episode/${ID}`,
      "https://example.com",
      `https://open.spotify.com/playlist/${ID}`,
      "https://spotify.link/AbCdEfG",
    ]) {
      const check = checkPlaylistLink(pasted);
      expect(check.submittable || check.problem !== null, pasted).toBe(true);
      expect(check.submittable && check.problem !== null, pasted).toBe(false);
      if (check.problem) expect(isAppErrorCode(check.problem)).toBe(true);
    }
    expect(checkPlaylistLink("my party mix").problem).toBe("invalid_playlist_url");
  });

  it("lets an editorial playlist through to the server, which refuses and counts it", () => {
    // Stopping it in the browser would make `playlist_refused:playlist_editorial`
    // fall for a reason that has nothing to do with what hosts are pasting.
    const pasted = `https://open.spotify.com/playlist/${EDITORIAL}`;
    expect(isSubmittablePlaylistLink(pasted)).toBe(true);
    expect(checkPlaylistLink(pasted).problem).toBeNull();
  });
});

describe("editorial playlists", () => {
  it("are the ids that begin 37i9", () => {
    expect(isEditorialPlaylistId(EDITORIAL)).toBe(true);
    expect(isEditorialPlaylistId(ID)).toBe(false);
  });

  it("are read off the id, not off the text", () => {
    expect(isEditorialPlaylistLink(`https://open.spotify.com/playlist/${EDITORIAL}?si=x`)).toBe(true);
    expect(isEditorialPlaylistLink(`spotify:playlist:${EDITORIAL}`)).toBe(true);
    // `includes("37i9")` — what the setup page ran — fires on all three of these.
    expect(isEditorialPlaylistLink(`https://open.spotify.com/playlist/${ID}?si=37i9abcdef`)).toBe(false);
    expect(isEditorialPlaylistLink("https://open.spotify.com/playlist/3cEYpjA937i9GiPac4AsH4")).toBe(false);
    expect(isEditorialPlaylistLink(`https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M`)).toBe(false);
    expect(isEditorialPlaylistLink("37i9")).toBe(false);
  });
});

describe("there is one reading, and everything else is a name for it", () => {
  const samples = [
    `https://open.spotify.com/playlist/${ID}?si=x`,
    `https://open.spotify.com/intl-ja/playlist/${ID}`,
    `https://open.spotify.com/user/u/playlist/${ID}`,
    `spotify:playlist:${ID}`,
    `https://open.spotify.com/album/${ID}`,
    "https://spotify.link/AbCdEfG",
    "https://open.spotify.com/playlist/short",
    `https://example.com/playlist/${ID}`,
    "just some words",
  ];

  it("has the server's parser agree with the classifier on every sample", () => {
    for (const pasted of samples) {
      const link = classifySpotifyLink(pasted);
      expect(parsePlaylistUrl(pasted), pasted).toBe(link.kind === "playlist" ? link.id : null);
    }
  });

  it("has the share target agree with the classifier on every sample", () => {
    for (const pasted of samples) {
      expect(parseSharedText(pasted), pasted).toEqual(classifySpotifyLink(pasted));
    }
  });

  it("has the server's editorial check agree with the classifier's", () => {
    for (const id of [EDITORIAL, ID, "", "37i9"]) {
      expect(isSpotifyEditorial(id)).toBe(isEditorialPlaylistId(id));
    }
  });

  it("round-trips an id through the address it writes", () => {
    expect(playlistUrlFromId(ID)).toBe(`https://open.spotify.com/playlist/${ID}`);
    expect(playlistIdFromLink(playlistUrlFromId(ID))).toBe(ID);
  });

  it("keeps the parsers out of the modules that used to have their own", () => {
    // A regex over "playlist" in either file is a second reading of what a
    // playlist link is, which is the bug this module replaced.
    for (const file of ["lib/spotify.ts", "lib/share-target.ts", "lib/playlist-cache.ts"]) {
      const source = code(read(file));
      expect(source, file).not.toMatch(/\/[^/\n]*playlist[^/\n]*\\\/[^/\n]*\//);
      expect(source, file).not.toMatch(/new RegExp\(/);
      expect(source, file).toMatch(/from "@\/lib\/spotify-link"/);
    }
  });
});

describe("the module can be loaded by a browser, including an old one", () => {
  const source = read("lib/spotify-link.ts");

  it("imports nothing that reaches KV or the network", () => {
    // It is pulled into the join pages' bundle. `types/preview.ts` exists for
    // the same reason: one import of lib/kv.ts brings the Upstash client along.
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, typeOnly, from] of imports) {
      expect(typeOnly, `${from} must be a type-only import`).toBeTruthy();
      expect(from).not.toMatch(/kv|playlist-cache|preview-cache|loop-stats|spotify-shortlink|upstash/);
    }
    expect(code(source)).not.toMatch(/\bfetch\(/);
  });

  it("uses no lookbehind", () => {
    // Safari before 16.4 cannot parse one, and a regex it cannot parse is a
    // SyntaxError for the whole module: the join page would be the crash
    // screen on exactly the phones that scanned a QR to get there.
    expect(code(source)).not.toMatch(/\(\?<[=!]/);
    // Nor a named group, for iOS 11.
    expect(code(source)).not.toMatch(/\(\?<\w/);
  });
});
