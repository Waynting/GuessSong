import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installStorage, installThrowingStorage } from "./helpers/storage";
import {
  PARTY_AFTER_SOLO_KEY,
  SOLO_AT_KEY,
  SOLO_STEPS,
  isSoloStep,
  nextSoloStep,
  parseSoloAt,
  partyGap,
  soloStepFitsBand,
  takeSoloStep,
} from "@/lib/solo-party";
import { LOOP_SURFACES } from "@/lib/loop-links";
import { parsePulse } from "@/lib/pulse";

const kv = vi.hoisted(() => ({ incrs: [] as string[] }));

vi.mock("@/lib/kv", () => ({
  dayBucket: () => "2026-11-15",
  getKvStore: async () => ({
    async incr(key: string) {
      kv.incrs.push(key);
      return 1;
    },
  }),
}));

const { recordGameStart, recordSoloInvite, SOLO_INVITE_OUTCOMES, __resetLivenessForTests } = await import(
  "@/lib/loop-stats"
);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-15T12:00:00.000Z").getTime();

beforeEach(() => {
  installStorage();
  kv.incrs = [];
  __resetLivenessForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const metrics = () => kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-15:", ""));

describe("the rule: a device's first solo game, then its first party after it, once each", () => {
  it("marks the first solo game and nothing after it", () => {
    const first = nextSoloStep({ soloAt: null, partySent: false }, "p1", NOW);
    expect(first).toEqual({ step: "solo_first", marks: { soloAt: NOW, partySent: false } });
    expect(nextSoloStep(first.marks, "p1", NOW + DAY).step).toBeNull();
  });

  it("reports a party only after a solo game, and only the first one", () => {
    expect(nextSoloStep({ soloAt: null, partySent: false }, "p3_4", NOW).step).toBeNull();
    const party = nextSoloStep({ soloAt: NOW, partySent: false }, "p2", NOW + 2 * DAY);
    expect(party).toEqual({ step: "party_week", marks: { soloAt: NOW, partySent: true } });
    expect(nextSoloStep(party.marks, "p5_plus", NOW + 3 * DAY).step).toBeNull();
  });

  it("buckets the gap: under a day, up to a week, later — and a clock set back is the same day", () => {
    expect(partyGap(0)).toBe("party_same_day");
    expect(partyGap(DAY - 1)).toBe("party_same_day");
    expect(partyGap(DAY)).toBe("party_week");
    expect(partyGap(7 * DAY)).toBe("party_week");
    expect(partyGap(7 * DAY + 1)).toBe("party_later");
    expect(partyGap(-5 * DAY)).toBe("party_same_day");
    expect(partyGap(Number.NaN)).toBe("party_same_day");
  });

  it("reads a corrupted mark as none, the host-game counter's rule", () => {
    expect(parseSoloAt(String(NOW))).toBe(NOW);
    for (const junk of [null, "", "abc", "12abc", "1e309", "-5", "0", "99999999999999999999"]) {
      expect(parseSoloAt(junk), String(junk)).toBeNull();
    }
  });
});

describe("the storage half", () => {
  it("writes the solo mark once and the party mark once, through the guarded helpers", () => {
    expect(takeSoloStep("p1", NOW)).toBe("solo_first");
    expect(window.localStorage.getItem(SOLO_AT_KEY)).toBe(String(NOW));
    expect(takeSoloStep("p1", NOW + DAY)).toBeNull();
    expect(window.localStorage.getItem(SOLO_AT_KEY)).toBe(String(NOW));
    expect(takeSoloStep("p2", NOW + 10 * DAY)).toBe("party_later");
    expect(window.localStorage.getItem(PARTY_AFTER_SOLO_KEY)).toBe("1");
    expect(takeSoloStep("p2", NOW + 11 * DAY)).toBeNull();
  });

  it("never throws when the browser refuses storage — it runs inside the playlist's try", () => {
    installThrowingStorage();
    expect(() => takeSoloStep("p1", NOW)).not.toThrow();
    expect(() => takeSoloStep("p2", NOW)).not.toThrow();
  });

  it("is called by the setup page's one start path, and the step rides on the start beacon", () => {
    const page = read("app/setup-page.tsx");
    expect(page.match(/takeSoloStep\(/g)).toHaveLength(1);
    expect(page).toMatch(/const soloStep = takeSoloStep\(players\);/);
    expect(page).toMatch(/\.\.\.\(soloStep \? \{ soloStep \} : \{\}\),/);
    expect(read("lib/loop-client.ts")).toMatch(/\.\.\.\(soloStep \? \{ soloStep \} : \{\}\),/);
  });
});

describe("the wire and the counter", () => {
  it("parses a known step and drops an unknown one without dropping the game", () => {
    const ok = parsePulse({ kind: "game_started", hostGameIndex: 1, players: "p1", soloStep: "solo_first" });
    expect(ok).toMatchObject({ kind: "game_started", soloStep: "solo_first" });
    const junk = parsePulse({ kind: "game_started", hostGameIndex: 1, players: "p1", soloStep: "solo_first:x" });
    expect(junk).toEqual({ kind: "game_started", hostGameIndex: 1, players: "p1" });
    expect(SOLO_STEPS.every(isSoloStep)).toBe(true);
  });

  it("writes solo_party:<step> only when the step fits the band", async () => {
    await recordGameStart(1, { players: "p1", soloStep: "solo_first" });
    expect(metrics()).toContain("solo_party:solo_first");

    kv.incrs = [];
    await recordGameStart(3, { players: "p2", soloStep: "party_same_day" });
    expect(metrics()).toContain("solo_party:party_same_day");

    for (const [players, soloStep] of [
      ["p3_4", "solo_first"],
      ["p1", "party_week"],
      [undefined, "solo_first"],
    ] as const) {
      kv.incrs = [];
      await recordGameStart(2, { players, soloStep });
      expect(metrics().some((m) => m.startsWith("solo_party:")), `${players} ${soloStep}`).toBe(false);
      expect(metrics()).toContain("games");
    }
    expect(soloStepFitsBand("solo_first", "p1")).toBe(true);
    expect(soloStepFitsBand("party_later", "p5_plus")).toBe(true);
  });
});

describe("the invite card (retired 2026-11-19; its counters stay readable)", () => {
  it("is a loop surface of its own, with its tap outcomes in a closed set", async () => {
    expect(LOOP_SURFACES).toContain("solo_invite");
    expect(parsePulse({ kind: "solo_invite", outcome: "shared" })).toEqual({ kind: "solo_invite", outcome: "shared" });
    expect(parsePulse({ kind: "solo_invite", outcome: "maybe" })).toBeNull();
    for (const outcome of SOLO_INVITE_OUTCOMES) {
      kv.incrs = [];
      await recordSoloInvite(outcome);
      expect(metrics()).toEqual([`solo_invite:${outcome}`]);
    }
  });

  it("is printed by npm run stats, not left in Other counters", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"solo_party:"');
    expect(rendered).toContain('"solo_invite:"');
    expect(script).toMatch(/Played alone, then as a party/);
  });
});
