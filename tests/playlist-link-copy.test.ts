import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSubmittablePlaylistLink } from "@/lib/spotify-link";

/**
 * The two pages that tell a person what to do about a link that did not
 * work, read against the classifier that decides whether it works.
 *
 * Prose drifts from code without anything failing. The share page told
 * people to share "a This Is playlist you saved" — one of Spotify's own,
 * refused every time — and the guide listed `spotify:playlist:…` as a link
 * that fails while both the server and the forms accepted it. Neither was
 * wrong when it was written in the sense that a test could have caught;
 * these are the tests.
 */

const ID = "3cEYpjA9oz9GiPac4AsH4n";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("/share/unsupported", () => {
  const page = read("app/share/unsupported/page.tsx");
  const table = page.match(/const COPY[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  const tip = page.match(/Tip:[\s\S]*?<\/p>/)?.[0] ?? "";

  it("has an entry to read", () => {
    expect(table).not.toBe("");
    for (const type of ["track", "artist", "unknown"]) {
      expect(table, type).toMatch(new RegExp(`\\b${type}: \\{`));
    }
  });

  it("has nothing to say about an album, because an album plays", () => {
    // The album entry was rewritten to promise nothing while
    // `playlist_invalid:album` measured the demand; since 2026-10-25 a shared
    // album lands on the setup page, so a sentence here would be a refusal
    // the server no longer makes.
    expect(table).not.toMatch(/\balbum: \{/);
    expect(isSubmittablePlaylistLink(`https://open.spotify.com/album/${ID}`)).toBe(true);
  });

  it("never sends anyone to a playlist the server refuses", () => {
    // "like a This Is playlist you saved" was the artist entry. Those are
    // Spotify's own (37i9…) and are refused every time — and "the playlist
    // that song lives in" is usually one too.
    expect(table).not.toMatch(/This Is/i);
    expect(table).not.toMatch(/lives? in/i);
    expect(table).not.toMatch(/any playlist you like/i);
    expect(table).not.toMatch(/artist's playlists|one of the artist/i);
    expect(table).toMatch(/playlist of your own/);
  });

  it("says in the tip which playlists cannot be loaded", () => {
    expect(tip).toMatch(/public/i);
    expect(tip).toMatch(/Spotify&apos;s own/);
  });
});

describe("the guide", () => {
  const guide = read("app/guides/spotify-playlist-not-working/page.tsx");
  const section =
    guide.match(/<h2>3\. It is the wrong kind of link<\/h2>([\s\S]*?)<h2>4\./)?.[1] ?? "";
  const failing = section.match(/ones that fail:[\s\S]*?<ul>([\s\S]*?)<\/ul>/)?.[1] ?? "";

  it("has a list of links that fail", () => {
    expect(failing).not.toBe("");
  });

  it("does not list as failing what the classifier accepts", () => {
    // It said `spotify:playlist:…` fails. Both the server and the forms read it.
    expect(isSubmittablePlaylistLink(`spotify:playlist:${ID}`)).toBe(true);
    expect(failing).not.toMatch(/spotify:playlist/);
    expect(isSubmittablePlaylistLink("https://spotify.link/AbCdEfG")).toBe(true);
    expect(failing).not.toMatch(/spotify\.link/);
    expect(isSubmittablePlaylistLink(`https://open.spotify.com/intl-ja/playlist/${ID}`)).toBe(true);
    expect(failing).not.toMatch(/intl-/);
  });

  it("still lists what the classifier refuses", () => {
    expect(isSubmittablePlaylistLink(`https://open.spotify.com/track/${ID}`)).toBe(false);
    expect(isSubmittablePlaylistLink(`https://open.spotify.com/artist/${ID}`)).toBe(false);
    expect(failing).toMatch(/artist or track/i);
  });

  it("lists an album among the links that work, now that it does", () => {
    // It was the first entry under "the ones that fail" until 2026-10-25.
    expect(isSubmittablePlaylistLink(`https://open.spotify.com/album/${ID}`)).toBe(true);
    expect(failing).not.toMatch(/album/i);
    const works = section.match(/spellings that look wrong and are not[\s\S]*?<ul>([\s\S]*?)<\/ul>/)?.[1] ?? "";
    expect(works).not.toBe("");
    expect(works).toMatch(/album/i);
    // And it does not promise the one thing an album cannot do.
    expect(works).toMatch(/order/i);
  });

  it("still says what to do with the spellings that work", () => {
    expect(section).toMatch(/spotify:playlist/);
    expect(section).toMatch(/spotify\.link/);
  });
});
