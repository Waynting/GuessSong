import { describe, expect, it } from "vitest";
import { formatMixList } from "@/lib/mix-export";
import type { Track } from "@/types";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    name: "Tusa",
    artists: ["KAROL G"],
    durationMs: 200_000,
    createdAt: "2026-08-14T00:00:00.000Z",
    contributors: ["Ana"],
    ...overrides,
  };
}

describe("formatMixList", () => {
  it("puts the playlist name, the count and the whole roster at the top", () => {
    const out = formatMixList({
      tracks: [track()],
      contributorNames: ["Ana", "Ben"],
      playlistName: "2-Player Mix",
    });
    expect(out.split("\n")[0]).toBe("2-Player Mix · guessong.app");
    expect(out.split("\n")[1]).toBe("1 song from Ana, Ben");
  });

  it("numbers the tracks and credits whoever brought each one", () => {
    const out = formatMixList({
      tracks: [
        track({ id: "a", name: "Tusa", artists: ["KAROL G"], contributors: ["Ana"] }),
        track({ id: "b", name: "Hey Jude", artists: ["The Beatles"], contributors: ["Ben"] }),
      ],
      contributorNames: ["Ana", "Ben"],
      playlistName: "2-Player Mix",
    });
    expect(out).toContain("1. Tusa — KAROL G (Ana)");
    expect(out).toContain("2. Hey Jude — The Beatles (Ben)");
  });

  it("credits every contributor of a shared track", () => {
    const out = formatMixList({
      tracks: [track({ contributors: ["Ana", "Ben", "Carla"] })],
      contributorNames: ["Ana", "Ben", "Carla"],
      playlistName: "3-Player Mix",
    });
    expect(out).toContain("(Ana, Ben & Carla)");
  });

  it("names a contributor whose playlist was sampled down to nothing", () => {
    // The whole reason the roster is passed in rather than derived from the
    // tracks. Sampling fills to a target and stops, so with enough people
    // somebody gets zero — and deriving the roster would delete them from the
    // record of an evening they took part in.
    const out = formatMixList({
      tracks: [track({ contributors: ["Ana"] })],
      contributorNames: ["Ana", "Dev"],
      playlistName: "2-Player Mix",
    });
    expect(out).toContain("Ana, Dev");
    expect(out).toContain("Dev submitted a playlist but none of it made this round.");
  });

  it("lists several empty-handed contributors in one sentence", () => {
    const out = formatMixList({
      tracks: [track({ contributors: ["Ana"] })],
      contributorNames: ["Ana", "Dev", "Eve"],
      playlistName: "3-Player Mix",
    });
    expect(out).toContain(
      "Dev and Eve submitted playlists but none of them made this round."
    );
  });

  it("says nothing about empty hands when everyone landed something", () => {
    const out = formatMixList({
      tracks: [
        track({ id: "a", contributors: ["Ana"] }),
        track({ id: "b", contributors: ["Ben"] }),
      ],
      contributorNames: ["Ana", "Ben"],
      playlistName: "2-Player Mix",
    });
    expect(out).not.toContain("none of it made");
    expect(out).not.toContain("none of them made");
  });

  it("still names the people when the pool is empty", () => {
    const out = formatMixList({
      tracks: [],
      contributorNames: ["Ana", "Ben"],
      playlistName: "2-Player Mix",
    });
    expect(out).toContain("0 songs from Ana, Ben");
    expect(out).toContain("Ana and Ben submitted playlists");
  });

  it("survives a missing roster and missing credits without throwing", () => {
    const out = formatMixList({
      tracks: [track({ contributors: undefined })],
      contributorNames: [],
      playlistName: "Mix",
    });
    expect(out).toContain("1 song");
    expect(out).toContain("1. Tusa — KAROL G");
  });

  it("drops blank names from the roster instead of printing a gap", () => {
    const out = formatMixList({
      tracks: [track()],
      contributorNames: ["Ana", "   ", ""],
      playlistName: "Mix",
    });
    expect(out.split("\n")[1]).toBe("1 song from Ana");
  });

  it("truncates a title long enough to wrap a phone message", () => {
    const long = "A".repeat(120);
    const out = formatMixList({
      tracks: [track({ name: long })],
      contributorNames: ["Ana"],
      playlistName: "Mix",
    });
    expect(out).toContain("…");
    expect(out).not.toContain(long);
  });

  it("pads the numbering so a three-digit pool still lines up", () => {
    // 144 is the real ceiling: 12 contributors times the largest per-player
    // sample.
    const tracks = Array.from({ length: 100 }, (_, i) =>
      track({ id: `t${i}`, name: `Song ${i}` })
    );
    const out = formatMixList({ tracks, contributorNames: ["Ana"], playlistName: "Mix" });
    expect(out).toContain("  1. Song 0");
    expect(out).toContain("100. Song 99");
  });

  it("handles a track with no artist credit", () => {
    const out = formatMixList({
      tracks: [track({ artists: [] })],
      contributorNames: ["Ana"],
      playlistName: "Mix",
    });
    expect(out).toContain("1. Tusa (Ana)");
  });
});
