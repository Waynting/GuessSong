/**
 * Does someone who tried the site alone come back and host a party?
 *
 * Since 2026-11-11 most games are one person, alone, arrived from Google — a
 * week of 30,701 one-player starts against 4,435 with two or more. Two
 * opposite readings fit that, and nothing in KV could tell them apart: a solo
 * try is the step before a party (leave it alone, help them remember the site),
 * or it is someone looking who never brings anyone (stop optimising for the
 * party with them). This is the number that decides which.
 *
 * Two marks in the device's `localStorage`, nothing else:
 *
 *   - `guesssong_solo_at` — when this device first started a one-player game.
 *     Written once; the start that writes it sends `solo_first`.
 *   - `guesssong_party_after_solo` — set by the first game with two or more
 *     players after that mark; that start sends `party_<gap>`, and none after it.
 *
 * So `solo_party:solo_first` counts devices, and the three `party_*` keys sum
 * to devices that went on to a party — once each. The gap is bucketed because
 * the two readings differ in it: a party the same day is most likely the
 * friends turning up after the host tried it, a party a week later is the
 * try having worked.
 *
 * Read as floors, for the reason every device counter here is one: iOS evicts
 * `localStorage` after seven days without a visit, which is exactly the gap
 * `party_later` measures. And it starts at deploy: a device that played alone
 * before carries no mark until its next solo game.
 *
 * Pure, in `lib/` for the usual reason — the suite cannot import a page. The
 * storage half goes through `lib/host-session.ts`'s guarded helpers, because
 * this runs inside `recordHostedStart`, whose `catch` reports a bad playlist:
 * a throw here would be a host told their playlist is broken.
 */

import { readStored, writeStored } from "@/lib/host-session";
import type { PlayerBand } from "@/lib/game-players";

export type SoloStep = "solo_first" | "party_same_day" | "party_week" | "party_later";

export const SOLO_STEPS: readonly SoloStep[] = [
  "solo_first",
  "party_same_day",
  "party_week",
  "party_later",
];

export function isSoloStep(value: unknown): value is SoloStep {
  return typeof value === "string" && (SOLO_STEPS as readonly string[]).includes(value);
}

/** The step a start may carry for its band: `solo_first` only alone, a party step only with company. */
export function soloStepFitsBand(step: SoloStep, band: PlayerBand | undefined): boolean {
  if (band === undefined) return false;
  return step === "solo_first" ? band === "p1" : band !== "p1";
}

export const SOLO_AT_KEY = "guesssong_solo_at";
export const PARTY_AFTER_SOLO_KEY = "guesssong_party_after_solo";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SoloMarks {
  /** Epoch ms of this device's first solo start, or null. */
  soloAt: number | null;
  /** Whether a party after it has already been reported. */
  partySent: boolean;
}

/** Elapsed time from the solo mark to the party, bucketed. */
export function partyGap(elapsedMs: number): Extract<SoloStep, `party_${string}`> {
  // A clock set backwards reads as the same day, not as a negative gap.
  if (!(elapsedMs >= 0) || elapsedMs < DAY_MS) return "party_same_day";
  return elapsedMs <= 7 * DAY_MS ? "party_week" : "party_later";
}

/**
 * What this start reports, and the marks to store after it. `null` step is
 * the ordinary case: a repeat solo game, a party with no solo before it, or
 * a party already reported.
 */
export function nextSoloStep(
  marks: SoloMarks,
  band: PlayerBand,
  now: number
): { step: SoloStep | null; marks: SoloMarks } {
  if (band === "p1") {
    if (marks.soloAt !== null) return { step: null, marks };
    return { step: "solo_first", marks: { ...marks, soloAt: now } };
  }
  if (marks.soloAt === null || marks.partySent) return { step: null, marks };
  return { step: partyGap(now - marks.soloAt), marks: { ...marks, partySent: true } };
}

/** Digits only, the `getHostGameCount` rule: a corrupted mark reads as none. */
export function parseSoloAt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads the marks, decides, writes them back. Never throws: every storage
 * call is guarded, and a browser that keeps nothing reports `solo_first` on
 * each solo start — an overcount of devices bounded by the browsers that
 * block storage, the same trade `getHostGameCount` makes in reverse.
 */
export function takeSoloStep(band: PlayerBand, now: number = Date.now()): SoloStep | null {
  const marks: SoloMarks = {
    soloAt: parseSoloAt(readStored(SOLO_AT_KEY)),
    partySent: readStored(PARTY_AFTER_SOLO_KEY) === "1",
  };
  const { step, marks: next } = nextSoloStep(marks, band, now);
  if (step === "solo_first" && next.soloAt !== null) writeStored(SOLO_AT_KEY, String(next.soloAt));
  if (step !== null && step !== "solo_first") writeStored(PARTY_AFTER_SOLO_KEY, "1");
  return step;
}
