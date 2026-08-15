import { describe, it, expect } from "vitest";
import { parsePulse } from "@/lib/pulse";
import { HOST_INDEX_CEILING } from "@/lib/loop-stats";
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
