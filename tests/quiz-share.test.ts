/**
 * lib/quiz-share.ts — the one share path every card uses. Pins that a share
 * sheet which throws is treated as a browser without one (clipboard next),
 * and that only AbortError reads as the person backing out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyLink, shareLink } from "@/lib/quiz-share";

function stubNavigator(nav: unknown) {
  vi.stubGlobal("navigator", nav);
}

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareLink", () => {
  const data = { url: "https://www.guessong.app/r/daily", text: "Daily #3", title: "GuessSong" };

  it("reports shared when the sheet resolves, and leaves the clipboard alone", async () => {
    const writeText = vi.fn();
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText } });
    expect(await shareLink(data, "msg")).toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reports dismissed on AbortError without copying anything", async () => {
    const writeText = vi.fn();
    stubNavigator({ share: vi.fn().mockRejectedValue(named("AbortError")), clipboard: { writeText } });
    expect(await shareLink(data, "msg")).toBe("dismissed");
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(["NotAllowedError", "TypeError", "InvalidStateError", "DataError"])(
    "falls back to the clipboard when the sheet throws %s",
    async (name) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubNavigator({ share: vi.fn().mockRejectedValue(named(name)), clipboard: { writeText } });
      expect(await shareLink(data, "the whole message")).toBe("copied");
      expect(writeText).toHaveBeenCalledWith("the whole message");
    }
  );

  it("copies the URL by default where there is no sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    expect(await shareLink(data)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it("reports failed only when both paths refuse, and never throws", async () => {
    stubNavigator({
      share: vi.fn().mockRejectedValue(named("NotAllowedError")),
      clipboard: { writeText: vi.fn().mockRejectedValue(named("NotAllowedError")) },
    });
    expect(await shareLink(data)).toBe("failed");
    stubNavigator({ share: vi.fn().mockRejectedValue(named("NotAllowedError")) });
    expect(await shareLink(data)).toBe("failed");
  });
});

describe("copyLink", () => {
  it("is the clipboard alone", async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await copyLink("x")).toBe("copied");
    stubNavigator({});
    expect(await copyLink("x")).toBe("failed");
  });
});
