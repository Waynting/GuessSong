/**
 * The owner's dashboard (`/q/mine`) and the words `/quiz` is indexed on.
 *
 * The route is driven against the in-process KV in tests/quiz-routes.test.ts;
 * this pins the pure halves and the source-level rules that nothing at
 * runtime would catch.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUIZ_TOKENS_MAX, parseSeenTakers } from "@/lib/quiz-session";
import { relativeTime } from "@/lib/quiz-copy";
import { QUIZ_MINE_MAX } from "@/types/quiz";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the dashboard's device side", () => {
  it("asks about exactly as many quizzes as the device can hold", () => {
    // A device holding more than the route accepts would get a 400 for its
    // whole dashboard; one holding fewer is fine but would mean the two drifted.
    expect(QUIZ_MINE_MAX).toBe(QUIZ_TOKENS_MAX);
  });

  it("reads back only well-formed seen counts", () => {
    expect(parseSeenTakers(null)).toEqual({});
    expect(parseSeenTakers("not json")).toEqual({});
    expect(parseSeenTakers("[1,2]")).toEqual({});
    expect(parseSeenTakers(JSON.stringify({ ABCDEF: 3, abcdef: 1, ABCDE: 2, GHJKLM: -1, NPQRST: 1.5 }))).toEqual({
      ABCDEF: 3,
    });
  });

  it("says when the last answer landed, coarsely, in both languages", () => {
    const now = Date.UTC(2026, 9, 3, 12);
    expect(relativeTime(now - 20_000, "en", now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, "en", now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, "zh", now)).toBe("3 小時前");
    expect(relativeTime(now - 2 * 86_400_000, "en", now)).toBe("2d ago");
    // A clock that runs behind the server's never reads as the future.
    expect(relativeTime(now + 60_000, "en", now)).toBe("just now");
  });

  it("lives under /q, where the layout's noindex covers it, and is linked from /quiz and the board", () => {
    expect(read("app/q/mine/page.tsx")).not.toMatch(/robots:/);
    expect(read("app/q/layout.tsx")).toMatch(/index:\s*false/);
    expect(read("app/quiz/quiz-create.tsx")).toContain('href="/q/mine"');
    expect(read("app/q/[code]/board/page.tsx")).toContain('href="/q/mine"');
  });

  it("never fetches on a timer", () => {
    const client = read("app/q/mine/mine-client.tsx");
    expect(client).not.toMatch(/setInterval\(/);
  });
});

describe("/quiz carries words a search can land on", () => {
  const page = read("app/quiz/page.tsx");
  const about = read("app/quiz/quiz-about.tsx");

  it("builds the JSON-LD from the English copy, the language the page is prerendered in", () => {
    // Google penalises structured data that says what the page does not. The
    // page prerenders English (useErrorLocale starts at en), so the schema
    // reads QUIZ_ABOUT.en and nothing typed out a second time.
    expect(page).toContain("const about = QUIZ_ABOUT.en;");
    expect(page).toMatch(/"@type":\s*"FAQPage",\s*mainEntity:\s*about\.faqs\.map\(/);
    expect(page).toMatch(/"@type":\s*"HowTo"[\s\S]*?step:\s*about\.steps\.map\(/);
    expect(page).toContain("JSON.stringify(ld)");
    // And the visible list reads the same table, by the device's language.
    expect(about).toContain("const about = QUIZ_ABOUT[locale];");
    expect(about).toContain("about.faqs.map(");
    expect(about).toContain("about.steps.map(");
  });

  it("says the same things in both languages", async () => {
    const { QUIZ_ABOUT } = await import("@/lib/quiz-about");
    expect(QUIZ_ABOUT.zh.steps).toHaveLength(QUIZ_ABOUT.en.steps.length);
    expect(QUIZ_ABOUT.zh.faqs).toHaveLength(QUIZ_ABOUT.en.faqs.length);
    // Written natively, so no English sentence may leak into the Chinese half
    // (Spotify, App and QR code are names, not sentences).
    const zh = JSON.stringify(QUIZ_ABOUT.zh).replace(/Spotify|App|QR code/g, "");
    expect(zh).not.toMatch(/[A-Za-z]{4,}\s+[A-Za-z]{3,}/);
    expect(QUIZ_ABOUT.zh.partyHref).toBe("/zh");
  });

  it("states the rules the code enforces, not other ones", async () => {
    const { QUIZ_ABOUT } = await import("@/lib/quiz-about");
    const en = JSON.stringify(QUIZ_ABOUT.en);
    const zh = JSON.stringify(QUIZ_ABOUT.zh);
    const { QUIZ_MIN_QUESTIONS, QUIZ_MAX_QUESTIONS, QUIZ_MAX_ENTRIES, QUIZ_OPTION_COUNT, QUIZ_TTL_SECONDS } =
      await import("@/types/quiz");
    expect(en).toContain(`${QUIZ_MIN_QUESTIONS} to ${QUIZ_MAX_QUESTIONS} questions`);
    expect(zh).toContain(`${QUIZ_MIN_QUESTIONS} 到 ${QUIZ_MAX_QUESTIONS} 題`);
    expect(QUIZ_OPTION_COUNT).toBe(2);
    expect(en).toContain("two songs");
    expect(zh).toContain("每題兩首歌");
    expect(QUIZ_MAX_ENTRIES).toBe(50);
    expect(en).toContain("Up to fifty friends");
    expect(zh).toContain("最多五十位朋友");
    expect(QUIZ_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(en).toContain("One week.");
    expect(zh).toContain("一週。");
  });
});
