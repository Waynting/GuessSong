import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { albumKey, pickSpread, shuffle, spreadByAlbum } from "@/lib/shuffle";

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
      // Any comparator that draws a random number: `() =>`, `(a, b) =>` or a
      // `function`. The first form alone let the other two through.
      .filter((file) => /\.sort\(\s*(?:\([^)]*\)\s*=>|function\b)[^;]{0,160}?Math\.random\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("has no second copy: nothing else hand-rolls Fisher-Yates", () => {
    const copies = ["app", "lib", "components"]
      .flatMap(sourceFiles)
      .filter((file) => !file.endsWith(join("lib", "shuffle.ts")))
      .filter((file) => /function shuffle\s*</.test(readFileSync(file, "utf8")));
    expect(copies).toEqual([]);
  });
});

type T = { id: string; artists: string[]; albumName?: string; albumImageUrl?: string };
const track = (id: string, album: string): T => ({ id, artists: ["A"], albumImageUrl: `cover-${album}` });

/** A playlist shaped like a fan's: a few whole albums and a tail of singles. */
function playlist(): T[] {
  const out: T[] = [];
  for (const [album, n] of [["x", 12], ["y", 10], ["z", 8]] as const) {
    for (let i = 0; i < n; i++) out.push(track(`${album}${i}`, album));
  }
  for (let i = 0; i < 30; i++) out.push(track(`s${i}`, `single${i}`));
  return out;
}

const adjacentPairs = (list: T[]) =>
  list.slice(1).filter((t, i) => albumKey(t) === albumKey(list[i])).length;

describe("albumKey", () => {
  it("uses the cover, then name with artist, then the track itself", () => {
    expect(albumKey({ id: "1", artists: ["A"], albumImageUrl: "u", albumName: "N" })).toBe("img:u");
    expect(albumKey({ id: "1", artists: ["Ａ"], albumName: " Greatest Hits " })).toBe(
      albumKey({ id: "2", artists: ["a"], albumName: "greatest hits" })
    );
    expect(albumKey({ id: "1", artists: ["A"], albumName: "Hits" })).not.toBe(
      albumKey({ id: "2", artists: ["B"], albumName: "Hits" })
    );
    expect(albumKey({ id: "1", artists: ["A"] })).not.toBe(albumKey({ id: "2", artists: ["A"] }));
  });
});

describe("spreadByAlbum", () => {
  it("is a permutation and leaves the input alone", () => {
    const input = playlist();
    const copy = [...input];
    const out = spreadByAlbum(input);
    expect(input).toEqual(copy);
    expect(out.map((t) => t.id).sort()).toEqual(copy.map((t) => t.id).sort());
  });

  it("puts no album back to back when the list allows it", () => {
    for (let r = 0; r < 300; r++) expect(adjacentPairs(spreadByAlbum(playlist()))).toBe(0);
  });

  it("does what it can when one album is most of the list", () => {
    const list = [...Array.from({ length: 8 }, (_, i) => track(`x${i}`, "x")), track("a", "a"), track("b", "b")];
    const out = spreadByAlbum(list);
    expect(out).toHaveLength(10);
    // Eight of ten from one album must repeat at least five times over.
    expect(adjacentPairs(out)).toBeLessThanOrEqual(5);
  });

  it("starts the game on any album, and with any of its tracks", () => {
    const first = new Map<string, number>();
    for (let r = 0; r < 3000; r++) {
      const id = spreadByAlbum(playlist())[0].id;
      first.set(id, (first.get(id) ?? 0) + 1);
    }
    // 60 tracks; every one of them should open a game sometimes.
    expect(first.size).toBe(60);
  });
});

describe("pickSpread", () => {
  it("takes one per album before a second from any, and is fair across albums", () => {
    const runs = 3000;
    const albums = new Map<string, number>();
    for (let r = 0; r < runs; r++) {
      const picked = pickSpread(playlist(), 20);
      expect(picked).toHaveLength(20);
      const keys = picked.map(albumKey);
      // 33 albums, 20 songs: never two from one album.
      expect(new Set(keys).size).toBe(20);
      for (const k of keys) albums.set(k, (albums.get(k) ?? 0) + 1);
    }
    // Each of 33 albums makes a 20-song game 20/33 of the time.
    const expected = (runs * 20) / 33;
    for (const count of albums.values()) {
      expect(count / expected).toBeGreaterThan(0.9);
      expect(count / expected).toBeLessThan(1.1);
    }
  });

  it("is fair inside an album", () => {
    const hits = new Map<string, number>();
    const runs = 10000;
    for (let r = 0; r < runs; r++) {
      for (const t of pickSpread(playlist(), 20)) if (t.id.startsWith("x")) hits.set(t.id, (hits.get(t.id) ?? 0) + 1);
    }
    const counts = [...hits.values()];
    expect(counts).toHaveLength(12);
    // The album is in 20/33 of games and then any of its 12 tracks equally.
    const expected = (runs * 20) / 33 / 12;
    for (const c of counts) {
      expect(c / expected).toBeGreaterThan(0.85);
      expect(c / expected).toBeLessThan(1.15);
    }
  });

  it("takes everything when asked for more than there is, and nothing for zero", () => {
    expect(pickSpread(playlist(), 500)).toHaveLength(60);
    expect(pickSpread(playlist(), 0)).toEqual([]);
  });
});
