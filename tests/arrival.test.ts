import { describe, it, expect } from "vitest";
import { ARRIVALS, arrivalOf, isArrival } from "@/lib/arrival";

const HOST = "www.guessong.app";
const from = (referrer: string | null) => arrivalOf({ referrer, host: HOST });

describe("arrivalOf", () => {
  it("names the search engines and apps that send people, by any of their hosts", () => {
    expect(from("https://www.google.com/")).toBe("google");
    expect(from("https://www.google.com.tw/")).toBe("google");
    expect(from("android-app://com.google.android.googlequicksearchbox/")).toBe("google");
    expect(from("https://www.bing.com/search?q=guess+the+song")).toBe("bing");
    expect(from("https://tw.search.yahoo.com/")).toBe("yahoo");
    expect(from("https://duckduckgo.com/")).toBe("duckduckgo");
    expect(from("https://search.naver.com/")).toBe("naver");
    expect(from("https://l.facebook.com/")).toBe("facebook");
    expect(from("android-app://com.facebook.katana/")).toBe("facebook");
    expect(from("https://l.instagram.com/")).toBe("instagram");
    expect(from("https://www.threads.net/")).toBe("threads");
    expect(from("https://t.co/abc")).toBe("x");
    expect(from("https://x.com/")).toBe("x");
    expect(from("https://line.me/R/")).toBe("line");
    expect(from("android-app://jp.naver.line.android/")).toBe("line");
    expect(from("https://www.reddit.com/r/party")).toBe("reddit");
    expect(from("https://youtu.be/xyz")).toBe("youtube");
    expect(from("https://www.tiktok.com/")).toBe("tiktok");
    expect(from("https://chatgpt.com/")).toBe("chatgpt");
    expect(from("https://www.perplexity.ai/")).toBe("perplexity");
  });

  it("files our own pages as internal, with or without www", () => {
    expect(from("https://www.guessong.app/guides/x")).toBe("internal");
    expect(from("https://guessong.app/zh")).toBe("internal");
  });

  it("files anyone else as external, and no referrer as none", () => {
    expect(from("https://someblog.example/post")).toBe("external");
    expect(from("")).toBe("none");
    expect(from(null)).toBe("none");
    expect(from("not a url")).toBe("none");
    expect(from("about:blank")).toBe("none");
  });

  it("does not match a label by substring — a host is not a bag of letters", () => {
    expect(from("https://notgoogle-reviews.example/")).toBe("external");
    expect(from("https://xbox.com/")).toBe("external");
  });

  it("only ever returns a member of the closed set", () => {
    for (const r of ["https://a.b.c/", "javascript:alert(1)", "https://google.evil.example/"]) {
      expect(ARRIVALS).toContain(from(r));
    }
    expect(isArrival("google")).toBe(true);
    expect(isArrival("https://google.com")).toBe(false);
  });
});
