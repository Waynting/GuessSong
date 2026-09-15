import { describe, it, expect, afterEach } from "vitest";
import {
  LOOP_CTA_LABEL,
  LOOP_FOOTER_LABEL,
  LOOP_QR_CAPTION,
  LOOP_SURFACES,
  arrivedFrom,
  isLoopSurface,
  loopHref,
  loopUrl,
  type LoopSurface,
} from "@/lib/loop-links";

describe("LOOP_SURFACES", () => {
  it("has no duplicates — a repeated name would merge two arms into one counter", () => {
    expect(new Set(LOOP_SURFACES).size).toBe(LOOP_SURFACES.length);
  });

  it("uses only URL-path-safe names, since each becomes a path segment", () => {
    for (const surface of LOOP_SURFACES) {
      expect(surface).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(encodeURIComponent(surface)).toBe(surface);
    }
  });
});

describe("isLoopSurface", () => {
  it("accepts every declared surface", () => {
    for (const surface of LOOP_SURFACES) {
      expect(isLoopSurface(surface)).toBe(true);
    }
  });

  it("rejects the shapes an untrusted URL segment actually arrives in", () => {
    // `/r/[surface]` is public, so these are inputs the route will really see.
    for (const bad of [
      "",
      " ",
      "buzz",
      "BUZZ_FOOTER",
      "buzz_footer ",
      "../../etc/passwd",
      "buzz_footer/../share",
      "__proto__",
      "constructor",
      "toString",
      "x".repeat(4096),
    ]) {
      expect(isLoopSurface(bad)).toBe(false);
    }
  });

  it("rejects non-strings without throwing", () => {
    for (const bad of [null, undefined, 0, 1, {}, [], true, Symbol("s")]) {
      expect(isLoopSurface(bad)).toBe(false);
    }
  });

  it("is not fooled by inherited Object properties", () => {
    // A plain-object lookup table would answer true for these. The Set does not.
    expect(isLoopSurface("hasOwnProperty")).toBe(false);
    expect(isLoopSurface("valueOf")).toBe(false);
  });
});

describe("loopHref", () => {
  it("is relative, so previews and localhost keep working", () => {
    for (const surface of LOOP_SURFACES) {
      expect(loopHref(surface)).toBe(`/r/${surface}`);
    }
  });

  it("round-trips through the route's own validator", () => {
    // The href and the server-side check must agree on the segment, which is
    // the whole reason both derive from LOOP_SURFACES.
    for (const surface of LOOP_SURFACES) {
      const segment = loopHref(surface).split("/").pop();
      expect(isLoopSurface(segment)).toBe(true);
    }
  });
});

describe("loopUrl", () => {
  const original = process.env.NEXT_PUBLIC_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = original;
  });

  it("defaults to production, because the card outlives the deploy that made it", () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(loopUrl("share")).toBe("https://www.guessong.app/r/share");
  });

  it("honours a configured base", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://staging.example.com";
    expect(loopUrl("share")).toBe("https://staging.example.com/r/share");
  });

  it("does not double the slash when the base carries a trailing one", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://www.guessong.app/";
    expect(loopUrl("share")).toBe("https://www.guessong.app/r/share");
  });

  it("produces something a QR scanner can hand to a browser", () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    const parsed = new URL(loopUrl("share"));
    expect(parsed.protocol).toBe("https:");
    expect(parsed.pathname).toBe("/r/share");
  });
});

describe("arrivedFrom", () => {
  it("passes through a surface we issued", () => {
    for (const surface of LOOP_SURFACES) {
      expect(arrivedFrom(surface)).toBe(surface);
    }
  });

  it("falls back to organic for a missing ref", () => {
    expect(arrivedFrom(null)).toBe("organic");
    expect(arrivedFrom(undefined)).toBe("organic");
    expect(arrivedFrom("")).toBe("organic");
  });

  it("never lets a hand-edited query string reach the analytics param", () => {
    // CLAUDE.md: user input must not become a GA4 param value. `/?ref=` is a
    // public URL, so this is the enforcement point, not a formality.
    const hostile = [
      "<script>alert(1)</script>",
      "buzz_footer'; DROP TABLE",
      "a".repeat(10_000),
      "share ",
      "SHARE",
    ];
    for (const value of hostile) {
      expect(arrivedFrom(value)).toBe("organic");
    }
  });

  it("returns a value inside the declared union, whatever it is given", () => {
    const allowed: string[] = [...LOOP_SURFACES, "organic"];
    for (const value of ["buzz_cta", "nonsense", null, ""]) {
      expect(allowed).toContain(arrivedFrom(value as LoopSurface | null));
    }
  });
});

describe("the loop's three sentences", () => {
  const labels = { LOOP_CTA_LABEL, LOOP_FOOTER_LABEL, LOOP_QR_CAPTION };

  it("are three different, non-empty, one-line strings", () => {
    // One goes through `fillText` on the result card, which does not wrap
    // and draws a newline as a glyph; the other two sit in one-line slots.
    for (const [name, label] of Object.entries(labels)) {
      expect(label.trim(), name).toBe(label);
      expect(label.length, name).toBeGreaterThan(0);
      expect(label, name).not.toMatch(/[\r\n]/);
    }
    expect(new Set(Object.values(labels)).size).toBe(3);
  });

  it("name the product in the footer exactly once, because the footer bolds it by splitting on it", () => {
    // components/loop-cta.tsx does `LOOP_FOOTER_LABEL.split("GuessSong")` and
    // renders `[prefix, <b>GuessSong</b>, suffix]`. Zero occurrences drops the
    // wordmark from the one line whose job is to say the name; two would
    // drop whatever sat between them, silently.
    expect(LOOP_FOOTER_LABEL.split("GuessSong")).toHaveLength(2);
  });

  it("keep the QR caption short enough to sit beside the code on the result card", () => {
    // lib/result-image.ts prints it at 13px to the right of a 60px QR on a
    // card whose text column is a few hundred pixels wide. A caption that
    // grows into a sentence is a caption that runs off the picture, and
    // nothing in the save path would say so.
    expect(LOOP_QR_CAPTION.length).toBeLessThanOrEqual(40);
  });
});
