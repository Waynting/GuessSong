import { describe, it, expect } from "vitest";
import {
  LYRIC_CANDIDATES_MAX,
  candidateLines,
  clampLyricLine,
  isUsableLyricLine,
  pickLyricLine,
} from "@/lib/lyric-fragment";
import { QUIZ_LYRIC_MAX_CHARS } from "@/types/quiz";

describe("isUsableLyricLine", () => {
  it("refuses credits, section labels, grunts and blanks", () => {
    for (const line of [
      "",
      "   ",
      "---",
      "[Chorus]",
      "(Verse 2)",
      "【副歌】",
      "作詞：方文山",
      "作曲 周杰倫",
      "Lyrics by Someone Else",
      "Produced by Max Martin",
      "oh oh oh",
      "yeah yeah yeah yeah",
      "愛",
    ]) {
      expect(isUsableLyricLine(line), JSON.stringify(line)).toBe(false);
    }
  });

  it("keeps a real line in either script, and does not read 'decomposed' as a credit", () => {
    expect(isUsableLyricLine("I'm only one call away")).toBe(true);
    expect(isUsableLyricLine("窗外的麻雀在電線桿上多嘴")).toBe(true);
    expect(isUsableLyricLine("the leaves decomposed beneath us")).toBe(true);
  });

  it("strips an LRC timestamp before judging", () => {
    expect(isUsableLyricLine("[00:12.34] I'm only one call away")).toBe(true);
    expect(isUsableLyricLine("[00:12.34]")).toBe(false);
  });
});

describe("clampLyricLine", () => {
  it("leaves a line within the cap alone", () => {
    expect(clampLyricLine("short line here")).toBe("short line here");
  });

  it("cuts a long Latin line at a word and marks it", () => {
    const long = "word ".repeat(40).trim();
    const out = clampLyricLine(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(QUIZ_LYRIC_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/ …$/);
    expect(out.replace("…", "").split(" ").every((w) => w === "word")).toBe(true);
  });

  it("counts code points, so an emoji on the boundary is never split", () => {
    const out = clampLyricLine("😀".repeat(QUIZ_LYRIC_MAX_CHARS + 5));
    expect(Array.from(out).length).toBe(QUIZ_LYRIC_MAX_CHARS);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });
});

describe("candidateLines", () => {
  const LYRIC = [
    "七里香 - 周杰倫",
    "作詞：方文山",
    "窗外的麻雀在電線桿上多嘴",
    "你說這一句很有夏天的感覺",
    "雨下整夜我的愛溢出就像雨水",
    "院子落葉跟我的思念厚厚一疊",
    "雨下整夜我的愛溢出就像雨水",
    "你突然對我說七里香的名字很美",
    "雨下整夜我的愛溢出就像雨水",
  ].join("\n");

  it("puts the chorus first, drops credits and every line naming the title", () => {
    const lines = candidateLines(LYRIC, "七里香", ["周杰倫"]);
    expect(lines[0]).toBe("雨下整夜我的愛溢出就像雨水");
    expect(lines.some((l) => l.includes("七里香"))).toBe(false);
    expect(lines.some((l) => l.includes("方文山"))).toBe(false);
    // Repeated three times, kept once.
    expect(lines.filter((l) => l === "雨下整夜我的愛溢出就像雨水")).toHaveLength(1);
  });

  it("ties go to the earlier line, so a song picks the same line every time", () => {
    const lines = candidateLines(LYRIC, "七里香", ["周杰倫"]);
    expect(lines.slice(1, 3)).toEqual(["窗外的麻雀在電線桿上多嘴", "你說這一句很有夏天的感覺"]);
    expect(candidateLines(LYRIC, "七里香", ["周杰倫"])).toEqual(lines);
  });

  it("excludes the title across scripts: a Simplified lyric does not leak a Traditional title", () => {
    // LRCLIB holds 演员 in Simplified; the playlist says 演員.
    const lines = candidateLines("简单点说话的方式简单点\n该配合你演出的我演员尽力在表演\n递进的情绪请省略", "演員", ["薛之謙"]);
    expect(lines.some((l) => l.includes("演员"))).toBe(false);
    expect(lines).toContain("简单点说话的方式简单点");
  });

  it("excludes the title with its qualifier and without", () => {
    const lines = candidateLines("Hello from the other side\nI must have called a thousand times", "Hello - Live", []);
    expect(lines).toEqual(["I must have called a thousand times"]);
  });

  it("holds at most LYRIC_CANDIDATES_MAX lines — a snippet index, never the lyric", () => {
    const many = Array.from({ length: 40 }, (_, i) => `this is line number ${i} of the song`).join("\n");
    expect(candidateLines(many, "Untitled", [])).toHaveLength(LYRIC_CANDIDATES_MAX);
  });

  it("returns nothing for nothing", () => {
    expect(candidateLines("", "Song", [])).toEqual([]);
    expect(candidateLines(null as never, "Song", [])).toEqual([]);
  });
});

describe("pickLyricLine", () => {
  it("skips a line naming the decoy and takes the next", () => {
    const candidates = ["you were my New Rules all along", "one more line to sing tonight"];
    expect(pickLyricLine(candidates, ["Levitating", "New Rules"])).toBe("one more line to sing tonight");
  });

  it("is null when every line names an option", () => {
    expect(pickLyricLine(["mojito on the beach tonight"], ["Mojito"])).toBeNull();
    expect(pickLyricLine([], ["Mojito"])).toBeNull();
  });

  it("does not exclude everything for a title that keys to nothing", () => {
    expect(pickLyricLine(["a perfectly fine line here"], ["!!!"])).toBe("a perfectly fine line here");
  });
});
