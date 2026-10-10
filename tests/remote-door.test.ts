// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_LOCALES } from "@/lib/error-messages";
import { REMOTE_DOOR_COPY } from "@/lib/remote-door";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the play-online fake door's copy", () => {
  it("is written for every locale, each different", () => {
    for (const locale of ERROR_LOCALES) {
      const copy = REMOTE_DOOR_COPY[locale];
      for (const text of [copy.link, copy.note, copy.quiz]) expect(text.trim()).not.toBe("");
    }
    expect(REMOTE_DOOR_COPY.zh.link).not.toBe(REMOTE_DOOR_COPY.en.link);
    expect(REMOTE_DOOR_COPY.zh.note).not.toBe(REMOTE_DOOR_COPY.en.note);
  });

  it("leaks no English into the Chinese", () => {
    const zh = REMOTE_DOOR_COPY.zh;
    for (const text of [zh.link, zh.note, zh.quiz]) expect(text).not.toMatch(/[A-Za-z]/);
  });

  it("says the room does not exist and promises no date, in both languages", () => {
    expect(REMOTE_DOOR_COPY.en.note).toMatch(/aren't built yet/);
    expect(REMOTE_DOOR_COPY.zh.note).toMatch(/還沒有做/);
    for (const locale of ERROR_LOCALES) {
      expect(REMOTE_DOOR_COPY[locale].note).not.toMatch(/soon|coming|即將|很快|\d/i);
    }
  });
});

describe("the setup page's wiring", () => {
  const body = code(read("app/page.tsx"));

  it("draws the door only once mounted, in the device's language", () => {
    expect(body).toMatch(/REMOTE_DOOR_COPY\[locale\]/);
    expect(body).toMatch(/\{mounted && \(\s*<div className="remote-door"/);
    expect(body).toMatch(/if \(mounted\) reportRemoteDoor\("shown"\)/);
  });

  it("counts the tap once per page load", () => {
    expect(body).toMatch(
      /setRemoteDoorOpen\(true\);\s*if \(remoteDoorTappedRef\.current\) return;\s*remoteDoorTappedRef\.current = true;\s*reportRemoteDoor\("tapped"\)/
    );
  });

  it("follows the setup surfaces' touch rules", () => {
    const css = read("components/setup-chrome.tsx");
    expect(css).toMatch(/@media \(hover: hover\) \{ \.remote-door \.text-link:hover/);
  });
});
