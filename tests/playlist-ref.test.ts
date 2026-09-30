// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  EDITORIAL_ID_PREFIX,
  isEditorialId,
  isEditorialLink,
  isPlaylistId,
  playlistIdOf,
  playlistUrlOf,
} from "@/lib/playlist-ref";
import { isSpotifyEditorial, parsePlaylistUrl } from "@/lib/spotify";

/**
 * `lib/playlist-ref.ts` is the browser's copy of a rule the server owns, kept
 * separate so the setup page does not import the Spotify client. A second
 * spelling of a rule is what this codebase keeps getting bitten by, so the
 * first thing pinned here is that the two spellings agree — on every link,
 * not only the tidy ones.
 */

const OWN = "3cEYpjA9oz9GiPac4AsH4n";
const EDITORIAL = "37i9dQZF1DXcBWIGoYBM5M";

const LINKS = [
  `https://open.spotify.com/playlist/${OWN}`,
  `https://open.spotify.com/playlist/${OWN}?si=abcdef0123456789`,
  `https://open.spotify.com/intl-ja/playlist/${OWN}`,
  `https://open.spotify.com/playlist/${EDITORIAL}`,
  `https://open.spotify.com/playlist/${EDITORIAL}?si=1`,
  `spotify:playlist:${OWN}`,
  `spotify:playlist:${EDITORIAL}`,
  `Check this out: https://open.spotify.com/playlist/${OWN} — it's good`,
  // Half-typed, which is what the field holds for most of the time it is
  // being filled in.
  "https://open.spotify.com/playlist/",
  "https://open.spotify.com/playlist/37i9",
  "https://open.spotify.com/playlist/3cEY",
  // Not playlists at all.
  `https://open.spotify.com/album/${OWN}`,
  `https://open.spotify.com/track/${OWN}`,
  "https://spotify.link/abcDEF123",
  "37i9dQZF1DXcBWIGoYBM5M",
  "",
  "   ",
];

describe("playlistIdOf", () => {
  it("reads the same id out of every link that the server does", () => {
    for (const link of LINKS) {
      expect(playlistIdOf(link), link).toBe(parsePlaylistUrl(link));
    }
  });

  it("finds the id in the forms a host actually pastes", () => {
    expect(playlistIdOf(`https://open.spotify.com/playlist/${OWN}?si=xyz`)).toBe(OWN);
    expect(playlistIdOf(`https://open.spotify.com/intl-ja/playlist/${OWN}`)).toBe(OWN);
    expect(playlistIdOf(`spotify:playlist:${OWN}`)).toBe(OWN);
    expect(playlistIdOf(`https://open.spotify.com/album/${OWN}`)).toBeNull();
    expect(playlistIdOf("")).toBeNull();
  });
});

describe("the editorial check asks the server's question", () => {
  it("agrees with the server about which ids are Spotify's own", () => {
    for (const id of [OWN, EDITORIAL, "37i9", "37i", "x37i9", "", "37I9dQZF1DXcBWIGoYBM5M"]) {
      expect(isEditorialId(id), id).toBe(isSpotifyEditorial(id));
    }
    expect(EDITORIAL_ID_PREFIX).toBe("37i9");
  });

  it("warns about exactly the links the server will refuse as editorial", () => {
    // The warning says these cannot be loaded. That is only true of the links
    // the server refuses for it, so the two have to pick out the same ones.
    for (const link of LINKS) {
      const id = parsePlaylistUrl(link);
      const refused = id !== null && isSpotifyEditorial(id);
      expect(isEditorialLink(link), link).toBe(refused);
    }
  });

  it("does not take those four characters anywhere else for an editorial playlist", () => {
    // What `playlistUrl.includes("37i9")` got wrong. Each of these is an
    // ordinary link, and under the old check each would now be told, in so
    // many words, that it cannot be loaded.
    for (const link of [
      `https://open.spotify.com/playlist/${OWN}?si=37i9abcdef012345`,
      "https://open.spotify.com/playlist/3cEY37i9oz9GiPac4AsH4n",
      "https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4A37i9",
      `my 37i9 mix https://open.spotify.com/playlist/${OWN}`,
      "37i9",
      `https://open.spotify.com/album/${EDITORIAL}`,
    ]) {
      expect(isEditorialLink(link), link).toBe(false);
    }
  });

  it("speaks up as soon as the id has begun that way, not once it is complete", () => {
    // The server parses whatever run of characters follows `playlist/`, so a
    // link cut short in the pasting is still refused as editorial.
    expect(isEditorialLink("https://open.spotify.com/playlist/37i9")).toBe(true);
    expect(isEditorialLink("https://open.spotify.com/playlist/37i")).toBe(false);
  });
});

describe("what is fit to be stored", () => {
  it("accepts 22 characters of base62 and nothing else", () => {
    expect(isPlaylistId(OWN)).toBe(true);
    expect(isPlaylistId(EDITORIAL)).toBe(true);
    for (const bad of [
      "",
      "3cEY",
      `${OWN}x`,
      OWN.slice(1),
      "3cEYpjA9oz9GiPac4AsH4!",
      "3cEYpjA9oz9GiPac4AsH4 ",
      `${OWN}\n`,
      "../../../../etc/passwd",
      null,
      undefined,
      22,
      {},
      [OWN],
    ]) {
      expect(isPlaylistId(bad), String(bad)).toBe(false);
    }
  });

  it("builds one address per playlist, with nothing of the pasted link left in it", () => {
    const pasted = `https://open.spotify.com/intl-ja/playlist/${OWN}?si=abcdef0123456789&pt=1`;
    const id = playlistIdOf(pasted);
    expect(id).toBe(OWN);
    expect(playlistUrlOf(id as string)).toBe(`https://open.spotify.com/playlist/${OWN}`);
    // And the address reads back as the same playlist, on both sides.
    expect(playlistIdOf(playlistUrlOf(OWN))).toBe(OWN);
    expect(parsePlaylistUrl(playlistUrlOf(OWN))).toBe(OWN);
  });
});
