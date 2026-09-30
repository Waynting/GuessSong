import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePulse } from "@/lib/pulse";
import {
  GAME_ENDS,
  GAME_ROUND_CEILING,
  HOST_INDEX_CEILING,
  SETUP_SOURCES,
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

describe("parsePulse — the setup source", () => {
  it("accepts every declared source", () => {
    for (const source of SETUP_SOURCES) {
      expect(parsePulse({ kind: "game_started", hostGameIndex: 2, source })).toEqual({
        kind: "game_started",
        hostGameIndex: 2,
        source,
      });
    }
  });

  it("parses a body with no source exactly as it did before there was one", () => {
    // Every page loaded before the deploy sends this. It is the ordinary
    // case for a while, not a malformed one.
    const parsed = parsePulse({ kind: "game_started", hostGameIndex: 1 });
    expect(parsed).toEqual({ kind: "game_started", hostGameIndex: 1 });
    expect(parsed && "source" in parsed).toBe(false);
  });

  it("carries the sub-mode and the source together on a mixed game", () => {
    expect(
      parsePulse({ kind: "game_started", hostGameIndex: 3, mixed: "phone", source: "mixed" })
    ).toEqual({ kind: "game_started", hostGameIndex: 3, mixed: "phone", source: "mixed" });
  });

  it("drops an undeclared source rather than letting it reach a KV key, and keeps the game", () => {
    // `host_setup:${value}` is a key.
    for (const bad of ["Typed", "pasted", "", "typed ", "__proto__", "constructor", "a".repeat(500), 1, true, null, {}, ["typed"]]) {
      const parsed = parsePulse({ kind: "game_started", hostGameIndex: 1, source: bad });
      expect(parsed, String(bad)).toEqual({ kind: "game_started", hostGameIndex: 1 });
      expect(parsed && "source" in parsed, String(bad)).toBe(false);
    }
  });

  it("judges the two optional fields separately — a bad one does not cost the good one", () => {
    expect(
      parsePulse({ kind: "game_started", hostGameIndex: 1, mixed: "qr", source: "mixed" })
    ).toEqual({ kind: "game_started", hostGameIndex: 1, source: "mixed" });
    expect(
      parsePulse({ kind: "game_started", hostGameIndex: 1, mixed: "room", source: "scanned" })
    ).toEqual({ kind: "game_started", hostGameIndex: 1, mixed: "room" });
  });

  it("still rejects the event when the index is the thing that is wrong", () => {
    expect(parsePulse({ kind: "game_started", hostGameIndex: "3", source: "typed" })).toBeNull();
  });

  it("does not let a source ride in on any other event", () => {
    expect(parsePulse({ kind: "loop_impression", surface: "share", source: "typed" })).toEqual({
      kind: "loop_impression",
      surface: "share",
    });
    expect(
      parsePulse({ kind: "game_finished", end: "played_out", roundsPlayed: 2, source: "typed" })
    ).toEqual({ kind: "game_finished", end: "played_out", roundsPlayed: 2 });
  });

  it("fits in the route's body limit with every field at its longest", () => {
    // app/api/pulse/route.ts refuses anything over 512 bytes as not one of ours.
    const longest = [...SETUP_SOURCES].sort((a, b) => b.length - a.length)[0];
    const body = JSON.stringify({
      kind: "game_started",
      hostGameIndex: Number.MAX_SAFE_INTEGER,
      mixed: "phone",
      source: longest,
    });
    expect(body.length).toBeLessThan(512);
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

describe("parsePulse — quiz copies", () => {
  // The clipboard's two outcomes, mirrored here rather than imported beside
  // the list at the top of the file: that import is the one line every new
  // event's tests have to touch.
  const COPY_OUTCOMES = ["copied", "failed"] as const;

  it("accepts every declared by × outcome pair, the results page included", () => {
    expect(QUIZ_SHARE_BYS).toContain("board");
    for (const by of QUIZ_SHARE_BYS) {
      for (const outcome of COPY_OUTCOMES) {
        expect(parsePulse({ kind: "quiz_copied", by, outcome })).toEqual({
          kind: "quiz_copied",
          by,
          outcome,
        });
      }
    }
  });

  it("refuses a sheet's outcome on a copy — that is the two-meanings problem one key over", () => {
    // `shared` and `dismissed` are what a share sheet says. A clipboard
    // cannot say either, and a copy event carrying one is a share filed
    // under the wrong kind.
    for (const outcome of ["shared", "dismissed", "COPIED", "", "__proto__", 1, null, undefined]) {
      expect(parsePulse({ kind: "quiz_copied", by: "owner", outcome })).toBeNull();
    }
    for (const by of ["host", "", "OWNER", "Board", "__proto__", 1, null]) {
      expect(parsePulse({ kind: "quiz_copied", by, outcome: "copied" })).toBeNull();
    }
  });

  it("keeps the two kinds apart, and strips what neither declares", () => {
    expect(parsePulse({ kind: "quiz_copied", by: "board", outcome: "failed", url: "https://x/q/ABC234", evil: 1 })).toEqual({
      kind: "quiz_copied",
      by: "board",
      outcome: "failed",
    });
    // A share that fell back to the clipboard is still a share.
    expect(parsePulse({ kind: "quiz_shared", by: "board", outcome: "copied" })).toEqual({
      kind: "quiz_shared",
      by: "board",
      outcome: "copied",
    });
  });
});

describe("the route records every kind the parser accepts", () => {
  // `app/api/pulse/route.ts` dispatches on `kind` with a switch that has no
  // default, and the compiler does not ask for one. A kind added to
  // `PulseEvent` and not to the switch parses, answers 204, and records
  // nothing: the beacon is sent, the counter never moves, and the row in
  // `npm run stats` reads as "nobody tapped it". Read both sources, the way
  // the .tsx tests do.
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("has a case, and a recorder under it, for each kind in the union", () => {
    const union = read("lib/pulse.ts").match(/export type PulseEvent =([\s\S]*?);\n/)?.[1] ?? "";
    const kinds = [...union.matchAll(/kind: "(\w+)"/g)].map((m) => m[1]);
    expect(kinds).toContain("quiz_copied");
    expect(kinds).toContain("quiz_shared");
    expect(kinds.length).toBeGreaterThanOrEqual(5);
    const route = read("app/api/pulse/route.ts");
    for (const kind of kinds) {
      expect(route, `no case for ${kind}`).toMatch(
        new RegExp(`case "${kind}":\\s*await record\\w+\\(event\\.`)
      );
    }
  });

  it("sends a copy to the copy recorder and a share to the share recorder", () => {
    const route = read("app/api/pulse/route.ts");
    expect(route).toMatch(/case "quiz_copied":\s*await recordQuizCopy\(event\.by, event\.outcome\);/);
    expect(route).toMatch(/case "quiz_shared":\s*await recordQuizShare\(event\.by, event\.outcome\);/);
  });

  it("has each button on the panel and the board report through its own function", () => {
    // Both reporters take `(by, outcome)` and `copied`/`failed` are valid
    // share outcomes, so a Copy handler calling `reportQuizShare` compiles.
    // That is how `owner:copied` came to mean two things.
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const [file, by] of [
      ["components/quiz-panel.tsx", "owner"],
      ["app/q/[code]/board/page.tsx", "board"],
    ] as const) {
      const body = code(read(file));
      const share = body.match(/async function handleShare\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
      const copy = body.match(/async function handleCopy\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
      expect(share, `${file} handleShare`).toContain(`reportQuizShare("${by}", outcome)`);
      expect(share, `${file} handleShare`).not.toContain("reportQuizCopy");
      expect(copy, `${file} handleCopy`).toContain(`reportQuizCopy("${by}", outcome)`);
      expect(copy, `${file} handleCopy`).not.toContain("reportQuizShare");
      // One call each in the whole file, and no third path to GA4 alone.
      expect(body.match(/reportQuizShare\(/g) ?? [], file).toHaveLength(1);
      expect(body.match(/reportQuizCopy\(/g) ?? [], file).toHaveLength(1);
      expect(body, file).not.toMatch(/trackEvent\("quiz_(share|copy)_tapped"/);
    }
  });

  it("sends both copies of each report, GA4 and KV, from the one function", () => {
    const client = read("lib/loop-client.ts");
    expect(client).toMatch(
      /export function reportQuizCopy\([^)]*\): void \{\s*trackEvent\("quiz_copy_tapped", \{ by, outcome \}\);\s*sendPulse\(\{ kind: "quiz_copied", by, outcome \}\);\s*\}/
    );
    expect(client).toMatch(
      /export function reportQuizShare\([^)]*\): void \{\s*trackEvent\("quiz_share_tapped", \{ by, outcome \}\);\s*sendPulse\(\{ kind: "quiz_shared", by, outcome \}\);\s*\}/
    );
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
