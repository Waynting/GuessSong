import { describe, it, expect } from "vitest";
import { parseSharedText, playlistUrlFromId } from "@/lib/share-target";

const ID = "37i9dQZF1DXcBWIGoYBM5M"; // 22 base62 chars

describe("parseSharedText", () => {
  it("extracts a standard playlist link", () => {
    expect(
      parseSharedText(`https://open.spotify.com/playlist/${ID}?si=abc123`)
    ).toEqual({ kind: "playlist", id: ID });
  });

  it("extracts a playlist link with intl path segment", () => {
    expect(
      parseSharedText(`https://open.spotify.com/intl-zh-tw/playlist/${ID}`)
    ).toEqual({ kind: "playlist", id: ID });
  });

  it("extracts a playlist link surrounded by share text", () => {
    expect(
      parseSharedText(
        `來聽聽這個歌單！ https://open.spotify.com/playlist/${ID}?si=x 超讚`
      )
    ).toEqual({ kind: "playlist", id: ID });
  });

  it("prefers the playlist when share text also mentions other links", () => {
    expect(
      parseSharedText(
        `https://open.spotify.com/playlist/${ID} via https://spotify.link/AbCdEfG`
      )
    ).toEqual({ kind: "playlist", id: ID });
  });

  it("detects spotify.link shortlinks", () => {
    expect(parseSharedText("Check https://spotify.link/AbCdEfG out")).toEqual({
      kind: "shortlink",
      url: "https://spotify.link/AbCdEfG",
    });
  });

  it("classifies track links", () => {
    expect(
      parseSharedText(`https://open.spotify.com/track/${ID}?si=y`)
    ).toEqual({ kind: "track" });
  });

  it("classifies album links (including intl paths)", () => {
    expect(
      parseSharedText(`https://open.spotify.com/intl-ja/album/${ID}`)
    ).toEqual({ kind: "album" });
  });

  it("classifies artist links", () => {
    expect(parseSharedText(`https://open.spotify.com/artist/${ID}`)).toEqual({
      kind: "artist",
    });
  });

  it("returns unknown for plain text", () => {
    expect(parseSharedText("just some words")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for a malformed playlist id", () => {
    expect(
      parseSharedText("https://open.spotify.com/playlist/short")
    ).toEqual({ kind: "unknown" });
  });
});

describe("playlistUrlFromId", () => {
  it("builds the canonical open.spotify.com URL", () => {
    expect(playlistUrlFromId(ID)).toBe(
      `https://open.spotify.com/playlist/${ID}`
    );
  });
});
