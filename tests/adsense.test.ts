// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The loader's publisher id lives in app/layout.tsx and the same id, minus the
// "ca-" prefix, has to appear in public/ads.txt. Nothing connects the two but
// this test: if they drift, the script still loads and the page still renders,
// AdSense just stops attributing the inventory and reports "Earnings at risk"
// somewhere nobody in this repo is looking. Same class of hand-sync failure as
// lib/loop-links.ts's three derived copies.
const layoutSource = readFileSync(
  join(process.cwd(), "app/layout.tsx"),
  "utf8"
);
const adsTxt = readFileSync(join(process.cwd(), "public/ads.txt"), "utf8");

/** The lines ads.txt crawlers actually read — comments and blanks dropped. */
function records(): string[][] {
  return adsTxt
    .split("\n")
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((field) => field.trim()));
}

describe("AdSense", () => {
  it("declares a publisher id in app/layout.tsx", () => {
    expect(layoutSource).toMatch(/ca-pub-\d+/);
  });

  it("serves an ads.txt whose publisher id matches the loader", () => {
    const inLayout = layoutSource.match(/ca-pub-(\d+)/)?.[1];
    const inAdsTxt = records().map((fields) => fields[1]);
    expect(inAdsTxt).toContain(`pub-${inLayout}`);
  });

  it("writes ads.txt in the four-field IAB format", () => {
    // A malformed line is skipped silently by the crawler, which reads exactly
    // like having no ads.txt at all.
    for (const fields of records()) {
      expect(fields.length).toBeGreaterThanOrEqual(3);
      expect(fields[0]).toBe("google.com");
      expect(fields[2]).toBe("DIRECT");
    }
    expect(records().length).toBeGreaterThan(0);
  });

  it("loads the script from Google's own host", () => {
    // A typo'd host is a script that never loads and never errors visibly.
    expect(layoutSource).toContain(
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
    );
  });
});
