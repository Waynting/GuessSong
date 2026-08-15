import { describe, expect, it } from "vitest";
import { describeRounds, summarizeRounds } from "@/lib/round-summary";
import type { RoundHistoryEntry } from "@/lib/round-history";

function round(overrides: Partial<RoundHistoryEntry> = {}): RoundHistoryEntry {
  return {
    trackId: "t1",
    contributors: ["Ana"],
    songWinner: null,
    albumWinner: null,
    sourceWinner: null,
    ...overrides,
  };
}

describe("summarizeRounds", () => {
  it("counts rounds nobody named and rounds traced to the right playlist", () => {
    const summary = summarizeRounds([
      round({ songWinner: "Ana", sourceWinner: "Ben" }),
      round({ songWinner: null, sourceWinner: "Ana" }),
      round({ songWinner: null, sourceWinner: null }),
    ]);
    expect(summary).toEqual({ played: 3, unnamed: 2, sourceCorrect: 2 });
  });

  it("returns zeroes for no history rather than dividing by nothing", () => {
    expect(summarizeRounds([])).toEqual({ played: 0, unnamed: 0, sourceCorrect: 0 });
  });

  it("counts every round unnamed when the room could not place any of it", () => {
    // The cross-culture case, and the one the whole line exists to make visible:
    // a scoreboard full of zeroes looks the same as a broken game.
    const summary = summarizeRounds([round(), round(), round(), round()]);
    expect(summary).toEqual({ played: 4, unnamed: 4, sourceCorrect: 0 });
  });

  it("counts every round named when the room knew all of it", () => {
    const summary = summarizeRounds([
      round({ songWinner: "Ana", sourceWinner: "Ana" }),
      round({ songWinner: "Ben", sourceWinner: "Ben" }),
    ]);
    expect(summary).toEqual({ played: 2, unnamed: 0, sourceCorrect: 2 });
  });

  it("ignores the album point, which is not what this line is about", () => {
    const summary = summarizeRounds([round({ albumWinner: "Ana" })]);
    expect(summary).toEqual({ played: 1, unnamed: 1, sourceCorrect: 0 });
  });
});

describe("describeRounds", () => {
  it("names both counts against the total played", () => {
    expect(describeRounds({ played: 20, unnamed: 14, sourceCorrect: 6 })).toBe(
      "14 of 20 songs nobody could name · 6 traced back to the right playlist"
    );
  });

  it("returns null with nothing recorded, so the caller renders nothing", () => {
    // A non-mixed game never fills the history, and "0 of 0 songs nobody could
    // name" is noise wearing the costume of a finding.
    expect(describeRounds({ played: 0, unnamed: 0, sourceCorrect: 0 })).toBeNull();
  });

  it("still speaks when every round was a blank", () => {
    expect(describeRounds({ played: 12, unnamed: 12, sourceCorrect: 0 })).toBe(
      "12 of 12 songs nobody could name · 0 traced back to the right playlist"
    );
  });
});
