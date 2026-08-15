import { describe, it, expect } from "vitest";
import {
  findSharedTracks,
  computeMostObscure,
  computeMostMainstream,
  buildTasteCard,
} from "@/lib/taste-card";
import type { Track } from "@/types";
import type { RoundHistoryEntry } from "@/lib/round-history";

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

describe("findSharedTracks", () => {
  it("returns only tracks with more than one contributor", () => {
    const tracks = [
      makeTrack({ id: "a", contributors: ["Alice", "Bob"] }),
      makeTrack({ id: "b", contributors: ["Alice"] }),
      makeTrack({ id: "c", contributors: ["Bob", "Carol"] }),
    ];
    const shared = findSharedTracks(tracks);
    expect(shared.map((t) => t.trackId).sort()).toEqual(["a", "c"]);
  });

  it("returns an empty array when no tracks are shared", () => {
    const tracks = [makeTrack({ id: "a", contributors: ["Alice"] })];
    expect(findSharedTracks(tracks)).toEqual([]);
  });
});

describe("computeMostObscure", () => {
  it("picks the contributor with the lowest correct-source-guess rate", () => {
    const history: RoundHistoryEntry[] = [
      { trackId: "a", contributors: ["Alice"], songWinner: null, albumWinner: null, sourceWinner: "Bob" },
      { trackId: "b", contributors: ["Alice"], songWinner: null, albumWinner: null, sourceWinner: null },
      { trackId: "c", contributors: ["Bob"], songWinner: null, albumWinner: null, sourceWinner: "Alice" },
      { trackId: "d", contributors: ["Bob"], songWinner: null, albumWinner: null, sourceWinner: "Alice" },
    ];
    // Alice: 1/2 correct (0.5). Bob: 2/2 correct (1.0). Alice is more obscure.
    const result = computeMostObscure(history);
    expect(result?.playerName).toBe("Alice");
    expect(result?.rate).toBe(0.5);
    expect(result?.totalTracks).toBe(2);
  });

  it("excludes shared (multi-contributor) tracks — no way to know which contributor was guessed", () => {
    const history: RoundHistoryEntry[] = [
      { trackId: "a", contributors: ["Alice", "Bob"], songWinner: null, albumWinner: null, sourceWinner: "Carol" },
    ];
    // A correct guess on a track shared by Alice and Bob doesn't say which
    // of them was actually named, so it can't be credited to either without
    // guessing — the track is excluded from both players' totals entirely.
    expect(computeMostObscure(history)).toBeNull();
  });

  it("only counts single-contributor tracks when a history mixes shared and solo tracks", () => {
    const history: RoundHistoryEntry[] = [
      { trackId: "a", contributors: ["Alice", "Bob"], songWinner: null, albumWinner: null, sourceWinner: "Carol" },
      { trackId: "b", contributors: ["Alice"], songWinner: null, albumWinner: null, sourceWinner: "Alice" },
    ];
    const result = computeMostObscure(history);
    expect(result?.playerName).toBe("Alice");
    expect(result?.totalTracks).toBe(1);
    expect(result?.rate).toBe(1);
  });

  it("breaks an all-zero tie by who contributed more, not by insertion order", () => {
    // The cross-culture room: nobody places anybody's music, so every rate is 0
    // and a plain `rate < best.rate` scan never fires. Before the tiebreak this
    // crowned whoever the Map saw first, i.e. whoever submitted earliest — an
    // award that reads as a finding and is an accident of ordering.
    const award = computeMostObscure([
      { trackId: "a1", contributors: ["Ana"], songWinner: null, albumWinner: null, sourceWinner: null },
      { trackId: "b1", contributors: ["Ben"], songWinner: null, albumWinner: null, sourceWinner: null },
      { trackId: "b2", contributors: ["Ben"], songWinner: null, albumWinner: null, sourceWinner: null },
      { trackId: "b3", contributors: ["Ben"], songWinner: null, albumWinner: null, sourceWinner: null },
    ]);
    expect(award).toEqual({
      playerName: "Ben",
      correctAttributions: 0,
      totalTracks: 3,
      rate: 0,
    });
  });

  it("still prefers the lower rate over the larger sample", () => {
    // The tiebreak must only apply on an exact tie. Ana at 0/1 is more obscure
    // than Ben at 5/10 however many tracks Ben brought.
    const history = [
      { trackId: "a1", contributors: ["Ana"], songWinner: null, albumWinner: null, sourceWinner: null },
      ...Array.from({ length: 10 }, (_, i) => ({
        trackId: `b${i}`,
        contributors: ["Ben"],
        songWinner: null,
        albumWinner: null,
        sourceWinner: i < 5 ? "Ana" : null,
      })),
    ];
    expect(computeMostObscure(history)?.playerName).toBe("Ana");
  });

  it("is stable when the rate and the track count both tie", () => {
    const history = [
      { trackId: "a1", contributors: ["Ana"], songWinner: null, albumWinner: null, sourceWinner: null },
      { trackId: "b1", contributors: ["Ben"], songWinner: null, albumWinner: null, sourceWinner: null },
    ];
    const first = computeMostObscure(history);
    expect(first).not.toBeNull();
    expect(computeMostObscure(history)).toEqual(first);
  });

  it("returns null with no history", () => {
    expect(computeMostObscure([])).toBeNull();
  });
});

describe("computeMostMainstream", () => {
  it("picks the contributor with the highest average popularity", () => {
    const tracks = [
      makeTrack({ id: "a", contributors: ["Alice"], popularity: 90 }),
      makeTrack({ id: "b", contributors: ["Alice"], popularity: 70 }),
      makeTrack({ id: "c", contributors: ["Bob"], popularity: 20 }),
    ];
    const result = computeMostMainstream(tracks);
    expect(result?.playerName).toBe("Alice");
    expect(result?.averagePopularity).toBe(80);
  });

  it("ignores tracks without a popularity value", () => {
    const tracks = [
      makeTrack({ id: "a", contributors: ["Alice"] }),
      makeTrack({ id: "b", contributors: ["Bob"], popularity: 50 }),
    ];
    const result = computeMostMainstream(tracks);
    expect(result?.playerName).toBe("Bob");
  });

  it("returns null when no track has popularity data", () => {
    const tracks = [makeTrack({ id: "a", contributors: ["Alice"] })];
    expect(computeMostMainstream(tracks)).toBeNull();
  });
});

describe("buildTasteCard", () => {
  it("assembles all three awards together", () => {
    const tracks = [
      makeTrack({ id: "a", contributors: ["Alice", "Bob"], popularity: 80 }),
      makeTrack({ id: "b", contributors: ["Bob"], popularity: 40 }),
    ];
    const history: RoundHistoryEntry[] = [
      { trackId: "a", contributors: ["Alice", "Bob"], songWinner: null, albumWinner: null, sourceWinner: "Carol" },
      { trackId: "b", contributors: ["Bob"], songWinner: null, albumWinner: null, sourceWinner: null },
    ];
    const card = buildTasteCard(tracks, history);
    expect(card.sharedTracks).toHaveLength(1);
    expect(card.mostObscure?.playerName).toBe("Bob");
    expect(card.mostMainstream?.playerName).toBe("Alice");
  });
});
