import { describe, it, expect } from "vitest";
import { parsePulse } from "@/lib/pulse";
import {
  GAME_ENDS,
  GAME_ROUND_CEILING,
  HOST_INDEX_CEILING,
  QUIZ_SHARE_BYS,
  QUIZ_SHARE_OUTCOMES,
} from "@/lib/loop-stats";
import { LOOP_SURFACES } from "@/lib/loop-links";

describe("parsePulse — impressions", () => {
  it("accepts every declared surface", () => {
    for (const surface of LOOP_SURFACES) {
      expect(parsePulse({ kind: "loop_impression", surface })).toEqual({
        kind: "loop_impression",
        surface,
      });
    }
  });

  it("rejects a surface we did not declare, which would become a KV key", () => {
    for (const surface of ["", "nonsense", "BUZZ_CTA", "a".repeat(500), 7, null]) {
      expect(parsePulse({ kind: "loop_impression", surface })).toBeNull();
    }
  });
});

describe("parsePulse — game starts", () => {
  it("accepts a plain index", () => {
    expect(parsePulse({ kind: "game_started", hostGameIndex: 3 })).toEqual({
      kind: "game_started",
      hostGameIndex: 3,
    });
  });

  it("clamps rather than rejects a corrupted counter, so a real game still counts", () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [-42, 1],
      [1.9, 1],
      [HOST_INDEX_CEILING + 1, HOST_INDEX_CEILING],
      [1e12, HOST_INDEX_CEILING],
    ];
    for (const [input, expected] of cases) {
      expect(parsePulse({ kind: "game_started", hostGameIndex: input })).toEqual({
        kind: "game_started",
        hostGameIndex: expected,
      });
    }
  });

  it("rejects a non-finite or non-numeric index", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined, {}]) {
      expect(parsePulse({ kind: "game_started", hostGameIndex: bad })).toBeNull();
    }
  });
});

describe("parsePulse — the mixed sub-mode", () => {
  it("accepts both declared sub-modes", () => {
    for (const mixed of ["room", "phone"] as const) {
      expect(parsePulse({ kind: "game_started", hostGameIndex: 1, mixed })).toEqual({
        kind: "game_started",
        hostGameIndex: 1,
        mixed,
      });
    }
  });

  it("omits the field entirely on a single-playlist game", () => {
    const parsed = parsePulse({ kind: "game_started", hostGameIndex: 1 });
    expect(parsed).toEqual({ kind: "game_started", hostGameIndex: 1 });
    expect(parsed && "mixed" in parsed).toBe(false);
  });

  it("drops an undeclared sub-mode rather than letting it reach a KV key", () => {
    // `mixed_pool:${value}` is a key. An unbounded string arriving there is how
    // an unauthenticated endpoint turns a counter namespace into a bill.
    for (const bad of ["Room", "qr", "", "__proto__", 1, true, null, {}]) {
      const parsed = parsePulse({ kind: "game_started", hostGameIndex: 1, mixed: bad });
      expect(parsed).toEqual({ kind: "game_started", hostGameIndex: 1 });
    }
  });

  it("keeps the game when only the sub-mode is corrupt", () => {
    // Same trade as the index clamp above: the game is real either way, and
    // losing one row of detail beats losing the number anyone reads.
    expect(parsePulse({ kind: "game_started", hostGameIndex: 4, mixed: "nonsense" })).not.toBeNull();
  });
});

describe("parsePulse — game ends", () => {
  it("accepts both declared ends with a round", () => {
    for (const end of GAME_ENDS) {
      expect(parsePulse({ kind: "game_finished", end, roundsPlayed: 7 })).toEqual({
        kind: "game_finished",
        end,
        roundsPlayed: 7,
      });
    }
  });

  it("rejects an end it did not declare, which would become a KV key", () => {
    for (const end of ["", "abandoned", "PLAYED_OUT", "__proto__", 1, null, undefined]) {
      expect(parsePulse({ kind: "game_finished", end, roundsPlayed: 3 })).toBeNull();
    }
  });

  it("clamps the round like the host index, so a corrupted counter keeps the game", () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [-3, 1],
      [4.8, 4],
      [GAME_ROUND_CEILING + 1, GAME_ROUND_CEILING],
      [1e9, GAME_ROUND_CEILING],
    ];
    for (const [input, expected] of cases) {
      expect(parsePulse({ kind: "game_finished", end: "ended_early", roundsPlayed: input })).toEqual({
        kind: "game_finished",
        end: "ended_early",
        roundsPlayed: expected,
      });
    }
  });

  it("rejects a non-finite or non-numeric round", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined, {}]) {
      expect(parsePulse({ kind: "game_finished", end: "played_out", roundsPlayed: bad })).toBeNull();
    }
  });
});

describe("parsePulse — quiz shares", () => {
  it("accepts every declared by × outcome pair", () => {
    for (const by of QUIZ_SHARE_BYS) {
      for (const outcome of QUIZ_SHARE_OUTCOMES) {
        expect(parsePulse({ kind: "quiz_shared", by, outcome })).toEqual({
          kind: "quiz_shared",
          by,
          outcome,
        });
      }
    }
  });

  it("rejects the event when either half is undeclared — both are key tails", () => {
    for (const by of ["host", "", "OWNER", "__proto__", 1, null]) {
      expect(parsePulse({ kind: "quiz_shared", by, outcome: "shared" })).toBeNull();
    }
    for (const outcome of ["sent", "", "SHARED", "downloaded", "__proto__", 1, null]) {
      expect(parsePulse({ kind: "quiz_shared", by: "owner", outcome })).toBeNull();
    }
  });

  it("strips unknown fields from the new shapes too", () => {
    expect(
      parsePulse({ kind: "quiz_shared", by: "taker", outcome: "copied", surface: "share", evil: 1 })
    ).toEqual({ kind: "quiz_shared", by: "taker", outcome: "copied" });
    expect(
      parsePulse({ kind: "game_finished", end: "played_out", roundsPlayed: 2, hostGameIndex: 9 })
    ).toEqual({ kind: "game_finished", end: "played_out", roundsPlayed: 2 });
  });
});

describe("parsePulse — everything else", () => {
  it("rejects bodies that are not objects", () => {
    for (const bad of [null, undefined, 0, "", "kind", [], true]) {
      expect(parsePulse(bad)).toBeNull();
    }
  });

  it("rejects an unknown kind rather than guessing", () => {
    expect(parsePulse({ kind: "something_new", surface: "share" })).toBeNull();
    expect(parsePulse({ surface: "share" })).toBeNull();
  });

  it("ignores extra fields instead of passing them through", () => {
    const parsed = parsePulse({
      kind: "loop_impression",
      surface: "share",
      evil: "<script>",
      hostGameIndex: 99,
    });
    expect(parsed).toEqual({ kind: "loop_impression", surface: "share" });
  });

  it("still strips unknown fields now that one optional field is legitimate", () => {
    // `mixed` became a real field on `game_started`, and the risk in adding the
    // first optional member to a shape that had none is that the parser stops
    // being a whitelist and starts being a passthrough. This pins that only the
    // named field survives — including on the event that declares it.
    const parsed = parsePulse({
      kind: "game_started",
      hostGameIndex: 2,
      mixed: "room",
      evil: "<script>",
      surface: "share",
    });
    expect(parsed).toEqual({ kind: "game_started", hostGameIndex: 2, mixed: "room" });
  });

  it("is not fooled by a prototype-polluting body", () => {
    const parsed = parsePulse(JSON.parse('{"__proto__":{"kind":"game_started"}}'));
    expect(parsed).toBeNull();
  });
});
