import { describe, it, expect } from "vitest";
import {
  fingerprint,
  mixedRosterKey,
  poolContributions,
  type PlaylistContribution,
} from "@/lib/mixed-playlist";
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

/** `n` tracks that share nothing with any other prefix's tracks. */
function solo(prefix: string, n: number): Track[] {
  return Array.from({ length: n }, (_, i) =>
    makeTrack({
      id: `${prefix}-${i}`,
      name: `${prefix} Song ${i}`,
      artists: [`${prefix} Artist ${i}`],
    })
  );
}

/** The same recording as submitted by someone else — same fingerprint, own id. */
function copy(track: Track): Track {
  return { ...track, id: `${track.id}-copy` };
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

  it("splits evenly when both contributors have plenty to give", () => {
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: solo("a", 50) },
      { playerName: "Bob", tracks: solo("b", 50) },
    ];

    const pooled = poolContributions(contributions, 8);

    expect(pooled).toHaveLength(16);
    expect(pooled.filter((t) => t.contributors.includes("Alice"))).toHaveLength(8);
    expect(pooled.filter((t) => t.contributors.includes("Bob"))).toHaveLength(8);
  });

  it("fills the game to contributors x sampledPerPlayer despite overlap", () => {
    // The regression: a shared song spends a slot from every contributor of it,
    // so this pair used to return ~12 of the 16 the host asked for, and the
    // more taste they had in common the shorter the game got.
    const shared = solo("shared", 20);
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: [...solo("a", 20), ...shared] },
      { playerName: "Bob", tracks: [...solo("b", 20), ...shared.map(copy)] },
    ];

    expect(poolContributions(contributions, 8)).toHaveLength(16);
  });

  it("backfills from whoever still has tracks when someone runs short", () => {
    const contributions: PlaylistContribution[] = [
      { playerName: "BigLister", tracks: solo("big", 50) },
      { playerName: "SmallLister", tracks: solo("small", 5) },
    ];

    const pooled = poolContributions(contributions, 8);

    // SmallLister cannot reach 8, so the shortfall is made up by the only
    // contributor who can — the game stays 16 songs long rather than 13.
    expect(pooled).toHaveLength(16);
    expect(pooled.filter((t) => t.contributors.includes("SmallLister"))).toHaveLength(5);
    expect(pooled.filter((t) => t.contributors.includes("BigLister"))).toHaveLength(11);
  });

  it("never returns more tracks than there are distinct songs", () => {
    // Two people with identical taste. A 16-song game here would have to repeat
    // songs, which is worse than an honest 10-song one.
    const identical = solo("shared", 10);
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: identical },
      { playerName: "Bob", tracks: identical.map(copy) },
    ];

    const pooled = poolContributions(contributions, 8);

    expect(pooled).toHaveLength(10);
    expect(new Set(pooled.map((t) => t.name)).size).toBe(10);
  });

  it("gives nobody less than the fair pass would have", () => {
    // Backfill only ever adds. Whatever the relaxation does, a contributor with
    // enough tracks still clears sampledPerPlayer.
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: solo("a", 30) },
      { playerName: "Bob", tracks: solo("b", 30) },
      { playerName: "Cara", tracks: solo("c", 2) },
    ];

    const pooled = poolContributions(contributions, 5);

    for (const name of ["Alice", "Bob"]) {
      expect(
        pooled.filter((t) => t.contributors.includes(name)).length
      ).toBeGreaterThanOrEqual(5);
    }
    expect(pooled).toHaveLength(15);
  });

  it("does not let one name that submitted twice buy two players' worth", () => {
    const contributions: PlaylistContribution[] = [
      { playerName: "Alice", tracks: solo("a", 50) },
      { playerName: "Alice", tracks: solo("a2", 50) },
    ];

    // One distinct contributor, so one player's worth of songs.
    expect(poolContributions(contributions, 8)).toHaveLength(8);
  });

  it("returns an empty pool for no contributions", () => {
    expect(poolContributions([], 8)).toEqual([]);
  });
});

describe("mixedRosterKey", () => {
  it("reads a reordered roster as the same question", () => {
    // Order cannot change which playlists are unreadable, so reordering must
    // not buy another round of requests.
    expect(mixedRosterKey(["b", "a", "c"])).toBe(mixedRosterKey(["a", "b", "c"]));
  });

  it("changes when a contributor is added, removed, or swapped", () => {
    const roster = mixedRosterKey(["a", "b"]);
    expect(mixedRosterKey(["a"])).not.toBe(roster);
    expect(mixedRosterKey(["a", "b", "c"])).not.toBe(roster);
    expect(mixedRosterKey(["a", "z"])).not.toBe(roster);
  });

  it("does not collide when a URL contains the delimiter", () => {
    // The reason this is JSON and not a join: these two rosters are different
    // and a naive `join(",")` would render both as the same string.
    expect(mixedRosterKey(["a,b"])).not.toBe(mixedRosterKey(["a", "b"]));
  });

  it("leaves the caller's array alone", () => {
    // It sorts, and sorting in place would quietly reorder the contributor
    // list the component is rendering from.
    const urls = ["c", "a", "b"];
    mixedRosterKey(urls);
    expect(urls).toEqual(["c", "a", "b"]);
  });
});
