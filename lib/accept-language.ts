/**
 * Which setup page a request for `/` gets, from its Accept-Language header.
 *
 * Read by `middleware.ts` and nothing else. Pure and import-free, because the
 * middleware runs on every request for `/` — the page that takes nearly all
 * of the site's traffic — and whatever it imports is bundled into that path.
 *
 * The rule is the reader's *top* preference, not "Portuguese appears
 * somewhere": a browser set to `en-US,en;q=0.9,pt;q=0.8` belongs to someone
 * who chose English first, and Googlebot (no header, or English) must get
 * today's `/` byte for byte. Ties keep the header's order, the way browsers
 * write it. A malformed header is English, never an error.
 */

/** The page a request for `/` is served: today's English, or `/pt`. */
export type RootLocale = "en" | "pt";

/** Bounds the work on a header an unauthenticated caller wrote. */
const MAX_HEADER_LENGTH = 512;
const MAX_ENTRIES = 16;

export function rootLocaleFor(acceptLanguage: string | null | undefined): RootLocale {
  if (!acceptLanguage) return "en";
  const entries = acceptLanguage.slice(0, MAX_HEADER_LENGTH).split(",").slice(0, MAX_ENTRIES);
  let best: { tag: string; q: number } | null = null;
  for (const entry of entries) {
    const [rawTag, ...params] = entry.trim().split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.trim().split("=");
      if (name?.trim().toLowerCase() === "q") {
        const parsed = Number(value);
        q = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    if (q <= 0) continue;
    // Strictly greater: the first of equal weights wins, as the header lists them.
    if (!best || q > best.q) best = { tag, q };
  }
  if (!best) return "en";
  return best.tag === "pt" || best.tag.startsWith("pt-") ? "pt" : "en";
}
