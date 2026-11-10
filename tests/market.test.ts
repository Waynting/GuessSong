// @vitest-environment node
import { describe, it, expect } from "vitest";
import { FALLBACK_MARKET, defaultMarket, marketFromHeaders, parseMarket } from "@/lib/market";

/**
 * The market an artist's top tracks are read in: the request's country, else
 * the deploy's default, else US. Two ASCII letters only — `?market=` from the
 * URL is never read, and a header Vercel cannot have sent is the fallback.
 */

const headers = (country?: string) => ({ get: (name: string) => (name === "x-vercel-ip-country" && country ? country : null) });

describe("parseMarket", () => {
  it("accepts exactly two ASCII letters, upper-cased, and nothing else", () => {
    expect(parseMarket("tw")).toBe("TW");
    expect(parseMarket("US")).toBe("US");
    expect(parseMarket("XK")).toBe("XK"); // Spotify's 400 is handled upstream, not here
    for (const bad of ["", "T", "TWN", "1A", "t w", " TW", "TW ", "台灣", 42, null, undefined, {}]) {
      expect(parseMarket(bad), String(bad)).toBeNull();
    }
  });
});

describe("marketFromHeaders", () => {
  it("reads the country header, and falls back when it is missing or not a market", () => {
    expect(marketFromHeaders(headers("tw"), "US" as never)).toBe("TW");
    expect(marketFromHeaders(headers(), "JP" as never)).toBe("JP");
    expect(marketFromHeaders(headers("123"), "JP" as never)).toBe("JP");
    expect(marketFromHeaders(headers("TWN"), "JP" as never)).toBe("JP");
  });

  it("takes its default from SPOTIFY_DEFAULT_MARKET, validated, else US", () => {
    expect(FALLBACK_MARKET).toBe("US");
    expect(defaultMarket({})).toBe("US");
    expect(defaultMarket({ SPOTIFY_DEFAULT_MARKET: "jp" })).toBe("JP");
    expect(defaultMarket({ SPOTIFY_DEFAULT_MARKET: "Japan" })).toBe("US");
    expect(defaultMarket({ SPOTIFY_DEFAULT_MARKET: "" })).toBe("US");
    expect(marketFromHeaders(headers(), defaultMarket({ SPOTIFY_DEFAULT_MARKET: "de" }))).toBe("DE");
  });
});
