import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LOOP_REF_TTL_MS,
  bumpHostGameCount,
  getHostGameCount,
  readStored,
  recallLoopRef,
  rememberLoopRef,
  removeStored,
  writeStored,
} from "@/lib/host-session";
import { installQuotaStorage, installStorage, installThrowingStorage } from "./helpers/storage";

const NOW = new Date("2026-08-09T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the test environment itself", () => {
  it("really has storage, so the assertions below are not vacuous", () => {
    // jsdom does not supply localStorage here. If the stub above ever stops
    // being installed, every other test in this file would still pass while
    // exercising only the unavailable-storage fallback. This is the canary.
    expect(typeof window.localStorage?.setItem).toBe("function");
    window.localStorage.setItem("canary", "1");
    expect(window.localStorage.getItem("canary")).toBe("1");
  });
});

describe("host game count", () => {
  it("starts at zero and counts up from one", () => {
    expect(getHostGameCount()).toBe(0);
    expect(bumpHostGameCount()).toBe(1);
    expect(bumpHostGameCount()).toBe(2);
    expect(getHostGameCount()).toBe(2);
  });

  it("survives a reload, which is the whole point", () => {
    bumpHostGameCount();
    bumpHostGameCount();
    // Nothing in-memory is carried over; the value comes back from storage.
    expect(getHostGameCount()).toBe(2);
  });

  it("reads a corrupted value as a fresh device rather than poisoning the count", () => {
    // "1e309" and "12abc" are the reason this does not use parseInt: it would
    // read them as 1 and 12, which look like counts rather than like damage.
    for (const junk of [
      "",
      " ",
      "abc",
      "NaN",
      "-3",
      "0",
      "1e309",
      "12abc",
      " 5",
      "5 ",
      "{}",
      "9".repeat(400),
    ]) {
      window.localStorage.setItem("guesssong_host_games", junk);
      expect(getHostGameCount()).toBe(0);
      expect(bumpHostGameCount()).toBe(1);
      window.localStorage.clear();
    }
  });

  it("never throws when storage is unavailable, and reports a first game", () => {
    // Safari with cookies blocked throws on access rather than returning null.
    // A party host is not going to debug that; the game must still start.
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => bumpHostGameCount()).not.toThrow();
    expect(bumpHostGameCount()).toBe(1);
  });

  it("reports zero rather than throwing when reads are blocked", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getHostGameCount()).toBe(0);
  });
});

describe("remembered loop attribution", () => {
  it("returns nothing before anything has been remembered", () => {
    expect(recallLoopRef(NOW)).toBeNull();
  });

  it("credits a game hosted weeks after the click", () => {
    // The conversion this measures is not same-session: someone taps the CTA
    // at a friend's party and hosts their own a fortnight later.
    rememberLoopRef("buzz_cta", NOW);
    expect(recallLoopRef(NOW + 14 * DAY)).toBe("buzz_cta");
  });

  it("ages out once the credit has outlived its cause", () => {
    rememberLoopRef("buzz_cta", NOW);
    expect(recallLoopRef(NOW + LOOP_REF_TTL_MS - 1)).toBe("buzz_cta");
    expect(recallLoopRef(NOW + LOOP_REF_TTL_MS + 1)).toBeNull();
  });

  it("keeps the most recent loop touch", () => {
    rememberLoopRef("join_footer", NOW);
    rememberLoopRef("share", NOW + DAY);
    expect(recallLoopRef(NOW + 2 * DAY)).toBe("share");
  });

  it("ignores a stored entry whose clock is impossibly far ahead", () => {
    // A device whose clock jumped backwards would otherwise keep a stale
    // credit alive forever.
    rememberLoopRef("share", NOW + 30 * DAY);
    expect(recallLoopRef(NOW)).toBeNull();
  });

  it("survives a hand-edited or truncated entry", () => {
    for (const junk of [
      "not json",
      "null",
      "[]",
      '{"surface":123,"at":0}',
      '{"surface":"share"}',
      '{"at":0}',
      '{"surface":"share","at":"soon"}',
    ]) {
      window.localStorage.setItem("guesssong_loop_ref", junk);
      expect(recallLoopRef(NOW)).toBeNull();
    }
  });

  it("does not validate the surface here — the analytics boundary does that", () => {
    // Storage is dumb on purpose; `arrivedFrom` in lib/loop-links.ts is the one
    // place that decides what may reach a GA4 param, so there is exactly one
    // gate to audit rather than two that can disagree.
    rememberLoopRef("something_else", NOW);
    expect(recallLoopRef(NOW)).toBe("something_else");
  });
});

describe("readStored / writeStored / removeStored", () => {
  it("round-trip one key through the guard", () => {
    expect(readStored("k")).toBeNull();
    writeStored("k", "v");
    expect(readStored("k")).toBe("v");
    removeStored("k");
    expect(readStored("k")).toBeNull();
  });

  it("answer null or nothing, never a throw, when the property access itself throws", () => {
    // Safari with "Block All Cookies": the getter throws before any method
    // is called. The buzzer surfaces read these in mount effects, where a
    // throw is app/error.tsx in place of the page.
    installThrowingStorage();
    expect(() => writeStored("k", "v")).not.toThrow();
    expect(readStored("k")).toBeNull();
    expect(() => removeStored("k")).not.toThrow();
  });

  it("answer null or nothing when only the method throws (quota)", () => {
    installQuotaStorage();
    expect(() => writeStored("k", "v")).not.toThrow();
    expect(readStored("k")).toBeNull();
  });
});
