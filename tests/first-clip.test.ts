import { describe, it, expect } from "vitest";
import { createFirstClipTracker, firstClipPath } from "@/lib/first-clip";
import { FIRST_CLIP_OUTCOMES } from "@/lib/loop-stats";

/**
 * One report per game page, for the first Play press only. The page settles
 * from six places and any of them can come first; this is what makes the
 * count one whatever order they arrive in.
 */
describe("the first clip is reported once", () => {
  it("reports the path the press took and how it came out", () => {
    const tracker = createFirstClipTracker();
    tracker.press("lazy");
    expect(tracker.settle("rejected")).toEqual({ path: "lazy", outcome: "rejected" });
  });

  it("answers the first settle and no other", () => {
    // `playing` fires and the play() promise resolves, for the same sound;
    // a teardown follows both. One report.
    const tracker = createFirstClipTracker();
    tracker.press("prefetched");
    expect(tracker.settle("played")).not.toBeNull();
    for (const outcome of FIRST_CLIP_OUTCOMES) expect(tracker.settle(outcome)).toBeNull();
  });

  it("reports nothing before a press", () => {
    // retireRound and reveal both settle unconditionally. A host who ends the
    // game without ever pressing Play has no first clip to have abandoned.
    const tracker = createFirstClipTracker();
    expect(tracker.settle("abandoned")).toBeNull();
    expect(tracker.pending()).toBe(false);
  });

  it("still reports a press that follows a settle nobody had armed", () => {
    const tracker = createFirstClipTracker();
    tracker.settle("abandoned");
    tracker.press("lazy");
    expect(tracker.settle("played")).toEqual({ path: "lazy", outcome: "played" });
  });

  it("is the first press's, even when the second one is the one that plays", () => {
    // A refused first press followed by a tap that works is one `rejected`.
    // The second tap working is what the fix looks like, not a second reading
    // — and counting it would hide the refusal this exists to find.
    const tracker = createFirstClipTracker();
    tracker.press("lazy");
    expect(tracker.settle("rejected")).toEqual({ path: "lazy", outcome: "rejected" });
    tracker.press("prefetched");
    expect(tracker.pending()).toBe(false);
    expect(tracker.settle("played")).toBeNull();
  });

  it("keeps the first press's path when a second press lands before it settles", () => {
    const tracker = createFirstClipTracker();
    tracker.press("lazy");
    tracker.press("prefetched");
    expect(tracker.settle("played")).toEqual({ path: "lazy", outcome: "played" });
  });

  it("knows a press is waiting, so a teardown can call it abandoned", () => {
    const tracker = createFirstClipTracker();
    tracker.press("lazy");
    expect(tracker.pending()).toBe(true);
    expect(tracker.settle("abandoned")).toEqual({ path: "lazy", outcome: "abandoned" });
    expect(tracker.pending()).toBe(false);
  });

  it("keeps each page's tracker to itself", () => {
    const a = createFirstClipTracker();
    const b = createFirstClipTracker();
    a.press("lazy");
    expect(b.settle("played")).toBeNull();
    expect(a.settle("played")).not.toBeNull();
  });
});

describe("which path a press takes", () => {
  it("is lazy only when nobody has asked about the track", () => {
    expect(firstClipPath(undefined)).toBe("lazy");
  });

  it("is prefetched when the URL was in hand", () => {
    expect(firstClipPath("https://audio.example/clip.m4a")).toBe("prefetched");
  });

  it("is prefetched for a settled 'no clip anywhere' — the press did not have to ask", () => {
    expect(firstClipPath(null)).toBe("prefetched");
  });
});
