import { describe, it, expect } from "vitest";
import {
  CHANGELOG,
  CHANGELOG_UI,
  LATEST_VERSION,
  changeText,
  entryHeadline,
  formatChangelogDate,
} from "@/lib/changelog";
import pkg from "@/package.json";

/** "1.2.3" -> [1, 2, 3], for comparing releases numerically rather than as strings. */
function parts(version: string): number[] {
  return version.split(".").map(Number);
}

function isDescending(a: string, b: string): boolean {
  const [aa, bb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

describe("CHANGELOG", () => {
  it("is ordered newest first", () => {
    // The overlay reports entries[0].version on changelog_opened, so an entry
    // added out of order would attribute its reads to the wrong release.
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      expect(
        isDescending(CHANGELOG[i].version, CHANGELOG[i + 1].version),
        `${CHANGELOG[i].version} should sort above ${CHANGELOG[i + 1].version}`
      ).toBe(true);
    }
  });

  it("exports the newest version as LATEST_VERSION", () => {
    expect(LATEST_VERSION).toBe(CHANGELOG[0].version);
  });

  it("stays in step with package.json", () => {
    // The overlay prints "Currently on v{LATEST_VERSION}" and changelog_opened
    // reports it. Bumping package.json without adding an entry here would show
    // every reader a stale version and file their reads under the wrong release
    // — silently, and only in the UI. Fail the build instead.
    expect(LATEST_VERSION).toBe(pkg.version);
  });

  it("gives every entry a date that actually formats", () => {
    // formatChangelogDate indexes a month table, so "2026-13-01" renders
    // "1 undefined 2026" rather than throwing. Hand-written dates need a guard
    // that catches the typo here instead of in front of users.
    for (const entry of CHANGELOG) {
      expect(entry.date, `${entry.version} date shape`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [, month, day] = entry.date.split("-").map(Number);
      expect(month, `${entry.version} month`).toBeGreaterThanOrEqual(1);
      expect(month, `${entry.version} month`).toBeLessThanOrEqual(12);
      expect(day, `${entry.version} day`).toBeGreaterThanOrEqual(1);
      expect(day, `${entry.version} day`).toBeLessThanOrEqual(31);
      for (const locale of ["en", "zh"] as const) {
        expect(formatChangelogDate(entry.date, locale)).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it("gives every entry a headline and at least one change", () => {
    for (const entry of CHANGELOG) {
      expect(entry.headline.trim().length).toBeGreaterThan(0);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });

  it("keys list items by text, so no two changes in a release may collide", () => {
    for (const entry of CHANGELOG) {
      const texts = entry.changes.map((c) => c.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("has no markdown in change text — the overlay renders it verbatim", () => {
    for (const entry of CHANGELOG) {
      for (const change of entry.changes) {
        expect(change.text).not.toMatch(/\*\*|`|\[.+\]\(.+\)/);
        expect(change.textZh).not.toMatch(/\*\*|`|\[.+\]\(.+\)/);
      }
    }
  });

  it("is fully bilingual — /zh must never fall back to English", () => {
    // The Chinese landing page is written natively rather than translated, so a
    // missing zh string showing through as English would be the one visible
    // seam in it.
    for (const entry of CHANGELOG) {
      expect(entry.headlineZh.trim().length, `${entry.version} headlineZh`).toBeGreaterThan(0);
      expect(entry.headlineZh).not.toBe(entry.headline);
      for (const change of entry.changes) {
        expect(change.textZh.trim().length, `${entry.version} "${change.text}"`).toBeGreaterThan(0);
        expect(change.textZh).not.toBe(change.text);
        // Any Han character. Catches an English string pasted into the zh field.
        expect(change.textZh, `${entry.version} "${change.text}"`).toMatch(/[一-鿿]/);
      }
    }
  });

  it("localises every UI string in both languages", () => {
    for (const locale of ["en", "zh"] as const) {
      const ui = CHANGELOG_UI[locale];
      for (const [key, value] of Object.entries(ui)) {
        if (typeof value === "string") {
          expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        }
      }
      for (const kind of ["new", "better", "fixed"] as const) {
        expect(ui.kinds[kind].trim().length, `${locale}.kinds.${kind}`).toBeGreaterThan(0);
      }
    }
    // The two languages must not share label text, or one of them is untranslated.
    expect(CHANGELOG_UI.zh.trigger).not.toBe(CHANGELOG_UI.en.trigger);
  });

  it("picks text by locale", () => {
    const entry = CHANGELOG[0];
    const change = entry.changes[0];
    expect(changeText(change, "en")).toBe(change.text);
    expect(changeText(change, "zh")).toBe(change.textZh);
    expect(entryHeadline(entry, "en")).toBe(entry.headline);
    expect(entryHeadline(entry, "zh")).toBe(entry.headlineZh);
  });
});

describe("formatChangelogDate", () => {
  it("formats an ISO date without touching the reader's locale", () => {
    // A locale-dependent format renders differently on the server than in the
    // browser, which React reports as a hydration mismatch.
    expect(formatChangelogDate("2026-07-29")).toBe("29 Jul 2026");
    expect(formatChangelogDate("2026-01-05")).toBe("5 Jan 2026");
    expect(formatChangelogDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("formats Chinese dates the way a Chinese reader writes them", () => {
    expect(formatChangelogDate("2026-07-30", "zh")).toBe("2026 年 7 月 30 日");
    expect(formatChangelogDate("2026-01-05", "zh")).toBe("2026 年 1 月 5 日");
  });

  it("defaults to English when no locale is given", () => {
    expect(formatChangelogDate("2026-07-30")).toBe(formatChangelogDate("2026-07-30", "en"));
  });
});
