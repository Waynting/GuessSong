import { describe, it, expect } from "vitest";
import nextConfig from "../next.config.js";

/**
 * The two spellings of the quiz link that predate `/quiz`. They are redirected
 * in Vercel's routing layer, before any HTML is served; the mount effect in
 * `app/page.tsx` is only the fallback. Pinned here because nothing else reads
 * `next.config.js`, and a dropped entry would fail silently — the fallback
 * still works, it just costs a full load of `/` first.
 */
describe("next.config.js redirects", () => {
  it("sends the old quiz spellings to /quiz without dropping the loop ref", async () => {
    const redirects = await nextConfig.redirects();
    const byQuery = (key: string, value: string) =>
      redirects.find((r: { has?: { type: string; key: string; value?: string }[] }) =>
        r.has?.some((h) => h.type === "query" && h.key === key && h.value === value)
      );
    for (const [key, value] of [
      ["mode", "quiz"],
      ["ref", "quiz_result"],
    ]) {
      const rule = byQuery(key, value);
      expect(rule, `${key}=${value}`).toBeDefined();
      if (!rule) return;
      expect(rule.source).toBe("/");
      // Next carries the request's query over, so the destination must not
      // spell `?ref=` itself or the ref would be repeated.
      expect(rule.destination).toBe("/quiz");
      expect(rule.permanent).toBe(false);
    }
  });

  it("never redirects a party-surface ref away from the party form", async () => {
    const redirects = await nextConfig.redirects();
    for (const r of redirects) {
      for (const h of r.has ?? []) {
        if (h.key === "ref") expect(h.value).toBe("quiz_result");
      }
    }
  });
});
