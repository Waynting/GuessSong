import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shuffle } from "@/lib/shuffle";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("shuffle", () => {
  it("returns a permutation and leaves the input alone", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(input);
    expect(input).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it("is uniform over position: the head of a long list is not favoured", () => {
    // The shape of the shipped bug: 300 tracks cut to 20. Under the random
    // comparator the first 50 were drawn ~1.48× as often as they should be.
    const tracks = Array.from({ length: 300 }, (_, i) => i);
    const runs = 4000;
    let head = 0;
    let tail = 0;
    for (let r = 0; r < runs; r++) {
      for (const t of shuffle(tracks).slice(0, 20)) {
        if (t < 50) head++;
        else if (t >= 250) tail++;
      }
    }
    const expected = (runs * 20 * 50) / 300;
    expect(head / expected).toBeGreaterThan(0.9);
    expect(head / expected).toBeLessThan(1.1);
    expect(tail / expected).toBeGreaterThan(0.9);
    expect(tail / expected).toBeLessThan(1.1);
  });

  it("is the only shuffle: nothing sorts by a random comparator", () => {
    const offenders = ["app", "lib", "components"]
      .flatMap(sourceFiles)
      .filter((file) => /\.sort\(\s*\(\)\s*=>[^)]*Math\.random\(\)/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
