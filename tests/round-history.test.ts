import { describe, expect, it } from "vitest";
import { closeRoundEntry, type ClosingRound } from "@/lib/round-history";
import { computeMostObscure } from "@/lib/taste-card";
import { summarizeRounds } from "@/lib/round-summary";

function closing(overrides: Partial<ClosingRound> = {}): ClosingRound {
  return {
    track: { id: "t1", contributors: ["Ana"] },
    revealed: true,
    songWinner: null,
    albumWinner: null,
    sourceWinner: null,
    via: "next",
    ...overrides,
  };
}

describe("closeRoundEntry", () => {
  it("records nothing for a track with no contributors", () => {
    expect(closeRoundEntry(closing({ track: { id: "t1" } }))).toBeNull();
    expect(closeRoundEntry(closing({ track: { id: "t1", contributors: [] } }))).toBeNull();
    expect(closeRoundEntry(closing({ track: undefined }))).toBeNull();
  });

  it("records the revealed round on screen when the host ends the game", () => {
    const entry = closeRoundEntry(closing({ via: "end", sourceWinner: "Ben", songWinner: "Ben" }));
    expect(entry).toEqual({
      trackId: "t1",
      contributors: ["Ana"],
      songWinner: "Ben",
      albumWinner: null,
      sourceWinner: "Ben",
      revealed: true,
    });
  });

  it("does not record an unrevealed round the host ended on", () => {
    expect(closeRoundEntry(closing({ via: "end", revealed: false }))).toBeNull();
  });

  it("records a skipped round from Next Track, marked unrevealed", () => {
    expect(closeRoundEntry(closing({ revealed: false }))?.revealed).toBe(false);
  });
});

describe("a skipped round is not a failed attribution", () => {
  const ana = (sourceWinner: string | null, revealed: boolean) =>
    closeRoundEntry(closing({ track: { id: "a", contributors: ["Ana"] }, sourceWinner, revealed }))!;
  const ben = (sourceWinner: string | null, revealed: boolean) =>
    closeRoundEntry(closing({ track: { id: "b", contributors: ["Ben"] }, sourceWinner, revealed }))!;

  it("leaves skipped rounds out of the most-obscure rate", () => {
    // Ana's one revealed track was placed; her two "No audio" skips were never
    // put to the room. Ben's tracks were placed once in two. Counting the
    // skips as misses makes Ana 1/3 and hands her the award.
    const history = [ana("Ben", true), ana(null, false), ana(null, false), ben("Ana", true), ben(null, true)];
    const award = computeMostObscure(history);
    expect(award?.playerName).toBe("Ben");
    expect(award?.rate).toBe(0.5);
    expect(computeMostObscure([ana(null, false)])).toBeNull();
  });

  it("still counts a skipped round as played and unnamed in the summary line", () => {
    expect(summarizeRounds([ana("Ben", true), ana(null, false)])).toEqual({
      played: 2,
      unnamed: 2,
      sourceCorrect: 1,
    });
  });
});
