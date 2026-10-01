import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  isSocialPlatform,
  socialPlatformsFor,
  socialShareUrl,
} from "@/lib/social-share";
import { QUIZ_SOCIAL_PLATFORMS } from "@/lib/loop-stats";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const URL_ = "https://www.guessong.app/q/ABC234";
const TEXT = "How well do you know Wayn & Co's music taste? 10 questions.";

describe("socialShareUrl", () => {
  it("builds each platform's intent, every value encoded", () => {
    const e = encodeURIComponent;
    expect(socialShareUrl("line", { url: URL_, text: TEXT })).toBe(
      `https://social-plugins.line.me/lineit/share?url=${e(URL_)}`
    );
    expect(socialShareUrl("threads", { url: URL_, text: TEXT })).toBe(
      `https://www.threads.net/intent/post?text=${e(`${TEXT} ${URL_}`)}`
    );
    expect(socialShareUrl("x", { url: URL_, text: TEXT })).toBe(
      `https://x.com/intent/post?text=${e(TEXT)}&url=${e(URL_)}`
    );
    expect(socialShareUrl("facebook", { url: URL_, text: TEXT })).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${e(URL_)}`
    );
    expect(socialShareUrl("whatsapp", { url: URL_, text: TEXT })).toBe(
      `https://wa.me/?text=${e(`${TEXT} ${URL_}`)}`
    );
  });

  it("never lets the text break out of its parameter", () => {
    // An owner's name is user input, and `&`, `#` and `?` in it would end
    // the parameter and start another — or drop the link off the end.
    const text = "A&B #1 ?x=y 品味鑒定";
    for (const platform of SOCIAL_PLATFORMS) {
      const built = new URL(socialShareUrl(platform, { url: URL_, text }));
      const params = [...built.searchParams.values()].join(" ");
      expect(params, platform).toContain(URL_);
      expect(built.hash, platform).toBe("");
      if (platform !== "line" && platform !== "facebook") expect(params, platform).toContain(text);
    }
  });

  it("puts the address alone where there is no text", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      const built = new URL(socialShareUrl(platform, { url: URL_ }));
      expect([...built.searchParams.values()], platform).toEqual([URL_]);
    }
  });
});

describe("the platform set", () => {
  it("is closed, and the counter's tails are the same set", () => {
    expect([...SOCIAL_PLATFORMS]).toEqual(["line", "threads", "x", "facebook", "whatsapp"]);
    expect([...QUIZ_SOCIAL_PLATFORMS]).toEqual([...SOCIAL_PLATFORMS]);
    for (const p of SOCIAL_PLATFORMS) expect(isSocialPlatform(p)).toBe(true);
    for (const bad of ["twitter", "LINE", "", "__proto__", 1, null, undefined]) {
      expect(isSocialPlatform(bad)).toBe(false);
    }
  });

  it("orders every platform for both readers, LINE first in Chinese and X first in English", () => {
    for (const locale of ["en", "zh"] as const) {
      expect([...socialPlatformsFor(locale)].sort()).toEqual([...SOCIAL_PLATFORMS].sort());
    }
    expect(socialPlatformsFor("zh")[0]).toBe("line");
    expect(socialPlatformsFor("en")[0]).toBe("x");
    for (const p of SOCIAL_PLATFORMS) expect(SOCIAL_PLATFORM_LABELS[p]).toBeTruthy();
  });
});

describe("the row", () => {
  const row = code(read("components/quiz-social-links.tsx"));

  it("is drawn only once an effect has found no share sheet", () => {
    // Starting visible would flash the row on every phone, and reading
    // `navigator` in render would disagree with the server's render.
    expect(row).toMatch(/useState\(false\)/);
    expect(row).toMatch(/useEffect\(\(\) => \{\s*setNoSheet\(typeof navigator\.share !== "function"\);\s*\}, \[\]\)/);
    expect(row).toMatch(/if \(!noSheet\) return null;/);
  });

  it("opens each platform in a new tab, and reports through its own function only", () => {
    expect(row).toMatch(/target="_blank"/);
    expect(row).toMatch(/rel="noopener noreferrer"/);
    expect(row).not.toMatch(/window\.open/);
    const handler = row.match(/function handleSocial\([^)]*\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(handler).toContain("reportQuizSocial(by, platform)");
    expect(row.match(/reportQuizSocial\(/g) ?? []).toHaveLength(1);
    expect(row).not.toMatch(/reportQuiz(Share|Copy)\(/);
    expect(row).not.toMatch(/trackEvent\(/);
  });

  it("is a ≥44px tap target on a row that wraps", () => {
    const css = read("components/quiz-social-links.tsx");
    expect(css).toMatch(/\.quiz-social-link \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.quiz-social-row \{[^}]*flex-wrap: wrap/);
  });

  it("is on all three surfaces, under the right sharer, with the plain quiz address", () => {
    for (const [file, by] of [
      ["components/quiz-panel.tsx", "owner"],
      ["app/q/[code]/board/page.tsx", "board"],
      ["app/q/[code]/quiz-client.tsx", "taker"],
    ] as const) {
      const body = code(read(file));
      const uses = [...body.matchAll(/<QuizSocialLinks\s+by="(\w+)"\s+url=\{([^}]*\}?)\}/g)];
      expect(uses, file).toHaveLength(1);
      expect(uses[0][1], file).toBe(by);
      // `quizUrl` is `/q/<CODE>` and nothing else; the taker's tab URL may
      // carry whatever the link it arrived by carried.
      expect(uses[0][2], file).toMatch(/^(url|quizUrl\(view\.code\))$/);
      if (file.endsWith("quiz-client.tsx")) expect(uses[0][2]).toBe("quizUrl(view.code)");
    }
  });
});
