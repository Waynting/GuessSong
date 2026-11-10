/**
 * The Spotify market an artist's top tracks are read in.
 *
 * `GET /artists/{id}/top-tracks` is the one endpoint the app calls that
 * *requires* a market on Client Credentials, and the answer differs by it: a
 * Mandopop act's top ten in TW is not its top ten in US. The country comes
 * from the request — Vercel's `x-vercel-ip-country` header, the first
 * platform-specific header in the codebase (`lib/rate-limit.ts` reads only
 * the generic forwarding ones) — and never from the URL: `?market=` would be
 * an unauthenticated input fanning the cache key out across 676 values.
 *
 * Branded, so a bare string cannot reach the cache key or the upstream URL
 * by accident: the only way to make one is through `parseMarket`, which
 * accepts exactly two ASCII letters and upper-cases them. Vercel can send
 * codes Spotify rejects (`XK`, `T1`); those pass here and are handled where
 * the 400 comes back (`getArtistTopTracks` retries once with the fallback).
 *
 * The fallback is `SPOTIFY_DEFAULT_MARKET`, run through the same parser, else
 * `US` — so a self-hosted deploy (the remedy the quota copy points people at)
 * and local dev are not pinned to the US market with no knob and no log.
 */

export type Market = string & { readonly __brand: "Market" };

const MARKET_RE = /^[A-Za-z]{2}$/;

export const FALLBACK_MARKET = "US" as Market;

/** Exactly two ASCII letters, upper-cased; anything else is null. */
export function parseMarket(value: unknown): Market | null {
  return typeof value === "string" && MARKET_RE.test(value) ? (value.toUpperCase() as Market) : null;
}

/** `SPOTIFY_DEFAULT_MARKET` when it is a market, else `US`. */
export function defaultMarket(env: Record<string, string | undefined> = process.env): Market {
  return parseMarket(env.SPOTIFY_DEFAULT_MARKET) ?? FALLBACK_MARKET;
}

/** The request's country, or the fallback when the header is missing or not a market. */
export function marketFromHeaders(
  headers: { get(name: string): string | null },
  fallback: Market = defaultMarket()
): Market {
  return parseMarket(headers.get("x-vercel-ip-country")) ?? fallback;
}
