import { describe, it, expect } from "vitest";
import {
  SONG_COUNTS,
  MAX_SONG_COUNT,
  DEFAULT_SONG_COUNT_STATE,
  isSongCountPreset,
  parseSongCount,
  clampSongCount,
  selectPreset,
  typeCustom,
  commitCustom,
  isCustomSelected,
  type SongCountState,
} from "@/lib/song-count";

/** Replay a host typing into the field one character at a time. */
function type(state: SongCountState, text: string): SongCountState {
  let next = state;
  for (let i = 1; i <= text.length; i++) next = typeCustom(next, text.slice(0, i));
  return next;
}

describe("parseSongCount", () => {
  it("accepts a count inside the range", () => {
    expect(parseSongCount("1")).toBe(1);
    expect(parseSongCount("37")).toBe(37);
    expect(parseSongCount(String(MAX_SONG_COUNT))).toBe(MAX_SONG_COUNT);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSongCount("  25 ")).toBe(25);
  });

  it("rejects rather than clamps, because it runs on every keystroke", () => {
    // "150" passes through "1" and "15"; clamping here would be harmless, but
    // clamping the far end would commit 500 the moment a host typed the first
    // digit of "5000" and then quietly disagree with the field.
    expect(parseSongCount(String(MAX_SONG_COUNT + 1))).toBeNull();
    expect(parseSongCount("0")).toBeNull();
    expect(parseSongCount("-5")).toBeNull();
  });

  it("rejects anything that is not a whole number", () => {
    expect(parseSongCount("")).toBeNull();
    expect(parseSongCount("   ")).toBeNull();
    expect(parseSongCount("abc")).toBeNull();
    expect(parseSongCount("2.5")).toBeNull();
    expect(parseSongCount("1e3")).toBeNull();
    expect(parseSongCount("Infinity")).toBeNull();
  });
});

describe("clampSongCount", () => {
  it("pulls an out-of-range number to the nearest end", () => {
    // The regression this exists for: rejecting 999 left the last in-range
    // prefix (99) selected, so the field snapped to a number nobody typed.
    expect(clampSongCount("999")).toBe(MAX_SONG_COUNT);
    expect(clampSongCount("0")).toBe(1);
    expect(clampSongCount("-12")).toBe(1);
  });

  it("passes an in-range count straight through", () => {
    expect(clampSongCount("37")).toBe(37);
    expect(clampSongCount(String(MAX_SONG_COUNT))).toBe(MAX_SONG_COUNT);
  });

  it("returns null when the field says nothing at all", () => {
    // Null is the caller's cue to fall back to the selected count. Clamping an
    // empty field to 1 would silently turn a cleared field into a one-song game.
    expect(clampSongCount("")).toBeNull();
    expect(clampSongCount("   ")).toBeNull();
    expect(clampSongCount("abc")).toBeNull();
  });

  it("floors a fractional count instead of refusing it", () => {
    expect(clampSongCount("12.9")).toBe(12);
    expect(clampSongCount("0.5")).toBe(1);
  });
});

describe("isSongCountPreset", () => {
  it("is true for every pill", () => {
    for (const c of SONG_COUNTS) expect(isSongCountPreset(c)).toBe(true);
  });

  it("is false for a typed count, which is what keeps the field populated", () => {
    expect(isSongCountPreset(37)).toBe(false);
    expect(isSongCountPreset(MAX_SONG_COUNT)).toBe(false);
  });
});

describe("selectPreset", () => {
  it("selects the preset and clears the custom field", () => {
    const after = selectPreset(30);
    expect(after).toEqual({ count: 30, field: "" });
  });

  it("clears a field that held a custom count, so the row shows one selection", () => {
    const custom = commitCustom(type(DEFAULT_SONG_COUNT_STATE, "37"));
    expect(selectPreset("all")).toEqual({ count: "all", field: "" });
    expect(custom.field).toBe("37"); // the state it replaced
  });
});

describe("typeCustom", () => {
  it("commits each keystroke that is already a usable count", () => {
    const after = type(DEFAULT_SONG_COUNT_STATE, "37");
    expect(after).toEqual({ count: 37, field: "37" });
  });

  it("holds the previous count while the number is still out of range", () => {
    // Typing "150" passes through "1" and "15". Following the field to 1 and
    // then 15 is fine; what must not happen is the field and the count
    // disagreeing about the finished value.
    const after = type(DEFAULT_SONG_COUNT_STATE, "150");
    expect(after).toEqual({ count: 150, field: "150" });

    // "999" never becomes usable — 9 and 99 do, 999 does not — so the count
    // stops at the last one that did.
    const overshoot = type(DEFAULT_SONG_COUNT_STATE, "999");
    expect(overshoot).toEqual({ count: 99, field: "999" });
  });

  it("keeps the count when the field is cleared mid-edit", () => {
    const typed = type(DEFAULT_SONG_COUNT_STATE, "37");
    expect(typeCustom(typed, "")).toEqual({ count: 37, field: "" });
  });
});

describe("commitCustom", () => {
  it("clamps an out-of-range number and rewrites the field to match", () => {
    // The regression: before clamping, blur left the field showing 99 — the
    // last in-range prefix of "999", a number the host never typed.
    const after = commitCustom(type(DEFAULT_SONG_COUNT_STATE, "999"));
    expect(after).toEqual({ count: MAX_SONG_COUNT, field: String(MAX_SONG_COUNT) });
  });

  it("clamps up from below the floor", () => {
    expect(commitCustom({ count: 20, field: "0" })).toEqual({ count: 1, field: "1" });
  });

  it("normalises whitespace around a valid count", () => {
    expect(commitCustom({ count: 20, field: " 25 " })).toEqual({ count: 25, field: "25" });
  });

  it("falls back to a preset by emptying the field", () => {
    expect(commitCustom({ count: 20, field: "" })).toEqual({ count: 20, field: "" });
    expect(commitCustom({ count: "all", field: "abc" })).toEqual({ count: "all", field: "" });
  });

  it("restores a committed custom count rather than emptying the field", () => {
    // The field must never go blank while a non-preset count is selected —
    // that renders as nothing chosen while the game would play 37 songs.
    expect(commitCustom({ count: 37, field: "" })).toEqual({ count: 37, field: "37" });
  });

  it("is idempotent, so a second blur cannot drift the value", () => {
    const once = commitCustom(type(DEFAULT_SONG_COUNT_STATE, "999"));
    expect(commitCustom(once)).toEqual(once);
  });
});

describe("isCustomSelected", () => {
  it("is true only when the field holds the selected count", () => {
    expect(isCustomSelected({ count: 37, field: "37" })).toBe(true);
    expect(isCustomSelected({ count: 20, field: "" })).toBe(false);
    // Mid-typing: the field says 999, the count says 99. Neither the field nor
    // any pill should claim to be the selection.
    expect(isCustomSelected({ count: 99, field: "999" })).toBe(false);
  });
});

describe("the whole control, driven the way a host drives it", () => {
  it("preset → custom → preset leaves exactly one thing selected", () => {
    let s: SongCountState = selectPreset(10);
    expect(isSongCountPreset(s.count) && s.field === "").toBe(true);

    s = commitCustom(type(s, "42"));
    expect(s).toEqual({ count: 42, field: "42" });
    expect(isSongCountPreset(s.count)).toBe(false);
    expect(isCustomSelected(s)).toBe(true);

    s = selectPreset("all");
    expect(s).toEqual({ count: "all", field: "" });
    expect(isCustomSelected(s)).toBe(false);
  });

  it("clearing the field and leaving it restores the custom count on screen", () => {
    let s = commitCustom(type(DEFAULT_SONG_COUNT_STATE, "42"));
    s = typeCustom(s, "");
    expect(s.count).toBe(42);
    s = commitCustom(s);
    expect(s).toEqual({ count: 42, field: "42" });
  });

  it("never lands on a count the game cannot honour", () => {
    for (const text of ["", " ", "0", "-4", "abc", "2.5", "999", "99999", "1e3"]) {
      const s = commitCustom(type(DEFAULT_SONG_COUNT_STATE, text));
      if (s.count !== "all") {
        expect(s.count).toBeGreaterThanOrEqual(1);
        expect(s.count).toBeLessThanOrEqual(MAX_SONG_COUNT);
        expect(Number.isInteger(s.count)).toBe(true);
      }
      // The field always agrees with the count once the host has left it.
      expect(s.field === "" ? isSongCountPreset(s.count) : Number(s.field) === s.count).toBe(true);
    }
  });
});

describe("the presets themselves", () => {
  it('offers "all" and stays inside the ceiling', () => {
    expect(SONG_COUNTS).toContain("all");
    for (const c of SONG_COUNTS) {
      if (typeof c === "number") {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(MAX_SONG_COUNT);
      }
    }
  });
});
