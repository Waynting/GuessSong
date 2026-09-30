import { describe, it, expect } from "vitest";
import { dropSilentUpcoming, silentSkippedLine } from "@/lib/track-queue";
import { PREVIEW_BATCH_MAX } from "@/types/preview";

/**
 * The FAQ on `/` promises that songs with no preview anywhere are skipped.
 * This is the rule that makes it true, and the four things it must never
 * take out of a game.
 */

const queue = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (tracks: readonly { id: string }[]) => tracks.map((t) => t.id);
const URL = "https://audio.example/clip.m4a";

describe("known-silent upcoming tracks are dropped", () => {
  it("drops an upcoming track whose settled answer is 'no clip anywhere'", () => {
    const result = dropSilentUpcoming(queue("a", "b", "c", "d"), 0, { a: URL, b: null, c: URL, d: null });
    expect(ids(result.queue)).toEqual(["a", "c"]);
    expect(result.dropped).toBe(2);
  });

  it("keeps the order of what is left", () => {
    const result = dropSilentUpcoming(queue("a", "b", "c", "d", "e"), 1, { c: null });
    expect(ids(result.queue)).toEqual(["a", "b", "d", "e"]);
  });

  it("never drops the track on screen, even when it is known to be silent", () => {
    // Its card is up and the host may be mid-press. It keeps the behaviour a
    // silent track has always had: the no-audio overlay, Reveal or Skip.
    for (const currentIndex of [0, 1, 2]) {
      const tracks = queue("a", "b", "c");
      const result = dropSilentUpcoming(tracks, currentIndex, { a: null, b: null, c: null });
      expect(ids(result.queue)).toContain(tracks[currentIndex].id);
    }
  });

  it("never drops anything already played, so the index keeps pointing at the same song", () => {
    const tracks = queue("a", "b", "c", "d", "e");
    const result = dropSilentUpcoming(tracks, 2, { a: null, b: null, c: URL, d: null, e: URL });
    expect(ids(result.queue)).toEqual(["a", "b", "c", "e"]);
    expect(result.queue[2]).toBe(tracks[2]);
  });

  it("never drops a track nobody has an answer for", () => {
    // `unavailable` is never written to the cache, so it reads as undefined
    // — the same as a track that was never asked about. Treating that as
    // silent would let one throttled minute delete a slice of the playlist.
    const result = dropSilentUpcoming(queue("a", "b", "c"), 0, { a: URL });
    expect(ids(result.queue)).toEqual(["a", "b", "c"]);
    expect(result.dropped).toBe(0);
  });

  it("never drops a track past the batch's cap, which was never asked about", () => {
    const long = Array.from({ length: PREVIEW_BATCH_MAX + 15 }, (_, i) => ({ id: `t${i}` }));
    const settled: Record<string, string | null> = {};
    // The batch answered for the first PREVIEW_BATCH_MAX, every third silent.
    long.slice(0, PREVIEW_BATCH_MAX).forEach((t, i) => {
      settled[t.id] = i % 3 === 0 ? null : URL;
    });
    const result = dropSilentUpcoming(long, 0, settled);
    const kept = new Set(ids(result.queue));
    for (const t of long.slice(PREVIEW_BATCH_MAX)) expect(kept.has(t.id)).toBe(true);
    // t0 is current and silent: kept. The other silent ones in the batch: gone.
    expect(kept.has("t0")).toBe(true);
    expect(kept.has("t3")).toBe(false);
    expect(result.dropped).toBe(Math.ceil(PREVIEW_BATCH_MAX / 3) - 1);
  });

  it("does not mistake an inherited property for an answer", () => {
    // The cache is a plain object keyed by an id off the wire.
    const result = dropSilentUpcoming(queue("a", "constructor", "toString", "__proto__"), 0, {});
    expect(result.dropped).toBe(0);
  });

  it("hands back the same array when nothing was dropped, so the page can skip the render", () => {
    const tracks = queue("a", "b", "c");
    expect(dropSilentUpcoming(tracks, 0, { a: URL, b: URL, c: URL }).queue).toBe(tracks);
    expect(dropSilentUpcoming(tracks, 2, { a: null, b: null, c: null }).queue).toBe(tracks);
  });

  it("does not change the queue it was given", () => {
    const tracks = queue("a", "b", "c");
    dropSilentUpcoming(tracks, 0, { b: null, c: null });
    expect(ids(tracks)).toEqual(["a", "b", "c"]);
  });

  it("ends the game on the current track when every remaining one is silent", () => {
    // The queue becomes the rounds played plus the one on screen, so the
    // reveal's button reads "See Final Scores" and End Game is not "early".
    const result = dropSilentUpcoming(queue("a", "b", "c", "d"), 1, { a: URL, b: URL, c: null, d: null });
    expect(ids(result.queue)).toEqual(["a", "b"]);
    expect(result.queue.length).toBe(1 + 1);
  });

  it("leaves a one-track game alone", () => {
    const tracks = queue("a");
    expect(dropSilentUpcoming(tracks, 0, { a: null })).toEqual({ queue: tracks, dropped: 0 });
  });

  it("removes nothing when the index is nonsense", () => {
    const tracks = queue("a", "b");
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dropSilentUpcoming(tracks, bad, { a: null, b: null })).toEqual({ queue: tracks, dropped: 0 });
    }
  });

  it("drops a later copy of a song and keeps the copy already played", () => {
    // A playlist can hold the same track twice.
    const result = dropSilentUpcoming(queue("a", "b", "a"), 1, { a: null, b: URL });
    expect(ids(result.queue)).toEqual(["a", "b"]);
  });

  it("keeps a Mixed pool's other fields on the tracks it keeps", () => {
    const tracks = [
      { id: "a", contributors: ["Amy"] },
      { id: "b", contributors: ["Ben"] },
      { id: "c", contributors: ["Amy", "Ben"] },
    ];
    const result = dropSilentUpcoming(tracks, 0, { b: null });
    expect(result.queue).toEqual([tracks[0], tracks[2]]);
  });
});

describe("the one line about it", () => {
  it("says nothing when nothing was skipped", () => {
    for (const none of [0, -1, Number.NaN]) expect(silentSkippedLine(none)).toBeNull();
  });

  it("counts in the singular and the plural", () => {
    expect(silentSkippedLine(1)).toBe("1 song with no preview anywhere was skipped");
    expect(silentSkippedLine(4)).toBe("4 songs with no preview anywhere were skipped");
  });

  it("uses the FAQ's phrase, not our word for being throttled", () => {
    expect(silentSkippedLine(3)).toMatch(/no preview anywhere/);
    expect(silentSkippedLine(3)).not.toMatch(/unavailable/i);
  });
});
