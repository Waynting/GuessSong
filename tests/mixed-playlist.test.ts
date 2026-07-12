import { describe, it, expect } from "vitest";
import { fingerprint, poolContributions, type PlaylistContribution } from "@/lib/mixed-playlist";
import type { Track } from "@/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    name: "Song",
    artists: ["Artist"],
    durationMs: 200000,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("fingerprint", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(fingerprint("Blinding Lights", ["The Weeknd"])).toBe(
      fingerprint("blinding lights", ["the weeknd"])
    );
  });

  it("collapses remaster/live/version suffixes to the same key", () => {
    const base = fingerprint("Come Together", ["The Beatles"]);
    expect(fingerprint("Come Together - Remastered 2009", ["The Beatles"])).toBe(base);
    expect(fingerprint("Come Together (Live)", ["The Beatles"])).toBe(base);
  });

  it("strips feat. credits from the title", () => {
    expect(fingerprint("Song (feat. Someone)", ["Artist"])).toBe(
      fingerprint("Song", ["Artist"])
    );
  });

  it("only keys off the primary artist", () => {
    expect(fingerprint("Song", ["Artist A", "Artist B"])).toBe(
      fingerprint("Song", ["Artist A"])
    );
  });

  it("distinguishes different songs", () => {
    expect(fingerprint("Song One", ["Artist"])).not.toBe(fingerprint("Song Two", ["Artist"]));
  });
});

describe("poolContributions", () => {
  it("merges a shared track's contributors instead of duplicating it", () => {
    const shared = makeTrack({ id: "shared", name: "Shared Song", artists: ["Someone"] });
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: [shared] },
      { playerName: "Bob", tracks: [{ ...shared, id: "shared-bob-copy" }] },
    ];

    const pooled = poolContributions(contributions, 8);

    expect(pooled).toHaveLength(1);
    expect(pooled[0].contributors.sort()).toEqual(["Alice", "Bob"]);
  });

  it("caps each contributor at sampledPerPlayer tracks", () => {
    const bigPlaylist: Track[] = Array.from({ length: 50 }, (_, i) =>
      makeTrack({ id: `big-${i}`, name: `Big Song ${i}`, artists: [`Artist ${i}`] })
    );
    const smallPlaylist: Track[] = Array.from({ length: 5 }, (_, i) =>
      makeTrack({ id: `small-${i}`, name: `Small Song ${i}`, artists: [`Small Artist ${i}`] })
    );
    const contributions: PlaylistContribution[] = [
      { playerName: "BigLister", tracks: bigPlaylist },
      { playerName: "SmallLister", tracks: smallPlaylist },
    ];

    const pooled = poolContributions(contributions, 8);

    const bigCount = pooled.filter((t) => t.contributors.includes("BigLister")).length;
    const smallCount = pooled.filter((t) => t.contributors.includes("SmallLister")).length;
    expect(bigCount).toBeLessThanOrEqual(8);
    expect(smallCount).toBeLessThanOrEqual(5);
  });

  it("counts a shared track against every one of its contributors' quotas", () => {
    const shared = makeTrack({ id: "shared", name: "Shared Song", artists: ["Someone"] });
    const aloneTracks: Track[] = Array.from({ length: 10 }, (_, i) =>
      makeTrack({ id: `a-${i}`, name: `Solo Song ${i}`, artists: [`Solo Artist ${i}`] })
    );
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: [shared, ...aloneTracks] },
      { playerName: "Bob", tracks: [{ ...shared, id: "shared-bob-copy" }] },
    ];

    const pooled = poolContributions(contributions, 3);

    const aliceCount = pooled.filter((t) => t.contributors.includes("Alice")).length;
    expect(aliceCount).toBeLessThanOrEqual(3);
  });

  it("returns an empty pool for no contributions", () => {
    expect(poolContributions([], 8)).toEqual([]);
  });
});
