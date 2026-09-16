import { describe, it, expect } from "vitest";
import { foldHan, hanFoldTable } from "@/lib/cjk-fold";

describe("cjk-fold", () => {
  it("is a well-formed single-character table", () => {
    const table = hanFoldTable();
    expect(table.size).toBeGreaterThan(3000);
    for (const [from, to] of table) {
      expect([...from]).toHaveLength(1);
      expect([...to]).toHaveLength(1);
      expect(from).not.toBe(to);
      const cp = from.codePointAt(0) ?? 0;
      expect(cp).toBeGreaterThanOrEqual(0x4e00);
      expect(cp).toBeLessThanOrEqual(0x9fff);
    }
  });

  it("is closed under itself: no target is also a source, so one fold is the last", () => {
    // OpenCC's raw tables chain: 麼 → 么 and 么 → 幺, so a raw dump keyed
    // 怎麼了 as 怎么了 and 怎么了 as 怎幺了 — the pool's own 怎麼了 offered as
    // the decoy for a Simplified 怎么了. The generator chases every target to
    // a fixpoint; this pins that it did, for every pair.
    const table = hanFoldTable();
    for (const [from, to] of table) {
      expect(table.has(to), `${from} → ${to} → ${table.get(to)}`).toBe(false);
      expect(foldHan(foldHan(from))).toBe(foldHan(from));
    }
    expect(foldHan("為什麼")).toBe(foldHan("为什么"));
    expect(foldHan("怎麼了")).toBe(foldHan("怎么了"));
    expect(foldHan("苧")).toBe(foldHan("苎"));
  });

  it("folds Traditional to Simplified, one character at a time", () => {
    expect(foldHan("演員")).toBe("演员");
    expect(foldHan("像我這樣的人")).toBe("像我这样的人");
    expect(foldHan("化身孤島的鯨")).toBe("化身孤岛的鲸");
    expect(foldHan("後來")).toBe("后来");
    // Taiwan- and Hong Kong-only variants land on the same form.
    expect(foldHan("裡")).toBe("里");
    expect(foldHan("裏")).toBe("里");
  });

  it("is idempotent and leaves everything that is not a Traditional character alone", () => {
    expect(foldHan("演员")).toBe("演员");
    expect(foldHan(foldHan("演員"))).toBe(foldHan("演員"));
    expect(foldHan("Hello, World")).toBe("Hello, World");
    expect(foldHan("夜に駆ける")).toBe("夜に駆ける");
    expect(foldHan("봄날")).toBe("봄날");
    expect(foldHan("")).toBe("");
  });

  it("folds onto a Simplified form outside the BMP, and steps over other astral characters", () => {
    // 180 of the table's targets are in CJK Extension B–F (僤 → 𫢸, 勣 → 𪟝):
    // two UTF-16 units each, so the fold must walk code points on both the
    // table and the input, or an emoji next to a Han character is split in
    // half and a lone surrogate is what reaches the key.
    expect(foldHan("僤")).toBe("𫢸");
    expect(foldHan("勣")).toBe("𪟝");
    expect(foldHan("演員🎵僤")).toBe("演员🎵𫢸");
    expect(foldHan("🎵")).toBe("🎵");
    expect(foldHan("🎵演員")).toBe("🎵演员");
    const table = hanFoldTable();
    const astral = [...table.values()].filter((to) => (to.codePointAt(0) ?? 0) > 0xffff);
    expect(astral.length).toBeGreaterThan(100);
    for (const to of astral) expect(to.length).toBe(2);
  });

  it("builds the table once and hands the same map back", () => {
    expect(hanFoldTable()).toBe(hanFoldTable());
  });
});
