/**
 * Where a first-time host's tab came from, as one of a closed set.
 *
 * Games went from ~1,400 a day to ~5,400 on 2026-10-07, peaked at 8,952 on
 * 2026-10-08 — the day the Spotify daily ceiling was spent — and stayed there.
 * First-time hosts tripled with them, so it was traffic and not a counting
 * change, and nothing in KV could say where it came from: `host_setup:*` says
 * how the playlist got into the field, `quiz_from:*` covers the quiz alone,
 * and GA4's acquisition report is the side nobody opens. A step that size
 * decides how much Spotify quota the site needs, so the next one has to be
 * answerable from `npm run stats`.
 *
 * Counted only for a device's first game (`new_host_from:<arrival>`), because
 * the question is who is arriving: a returning host's referrer is whatever
 * they happened to open the tab from tonight.
 *
 * **The referrer is compared, never kept** — `lib/quiz-source.ts`'s rule. A
 * referrer is a URL somebody else wrote; only one of the names below ever
 * leaves this module. `android-app://` referrers (an Android app opening the
 * link) parse with the package as the host, which is why the rules match on
 * labels rather than whole hosts: `com.facebook.katana` is Facebook.
 *
 * Dependency-free: the setup page, the pulse parser and the KV recorder all
 * import it.
 */

export const ARRIVALS = [
  "google",
  "bing",
  "yahoo",
  "duckduckgo",
  "naver",
  "facebook",
  "instagram",
  "threads",
  "x",
  "line",
  "reddit",
  "youtube",
  "tiktok",
  "chatgpt",
  "perplexity",
  /** Somebody else's site, not one of the above. */
  "external",
  /** A full navigation from one of our own pages. */
  "internal",
  /** No referrer: typed, bookmarked, installed, or stripped on the way. */
  "none",
] as const;

export type Arrival = (typeof ARRIVALS)[number];

const ARRIVAL_SET: ReadonlySet<string> = new Set(ARRIVALS);

export function isArrival(value: unknown): value is Arrival {
  return typeof value === "string" && ARRIVAL_SET.has(value);
}

/**
 * First match wins, so order matters once: LINE's Android package is
 * `jp.naver.line.android`, and it is LINE, not a Naver search.
 */
const RULES: ReadonlyArray<[Arrival, (labels: string[], host: string) => boolean]> = [
  ["line", (l, h) => h === "line.me" || h.endsWith(".line.me") || (l.includes("naver") && l.includes("line"))],
  ["google", (l) => l.includes("google") || l.includes("googlequicksearchbox")],
  ["bing", (l) => l.includes("bing")],
  ["yahoo", (l) => l.includes("yahoo")],
  ["duckduckgo", (l) => l.includes("duckduckgo")],
  ["naver", (l) => l.includes("naver")],
  ["facebook", (l) => l.includes("facebook") || l.includes("fb")],
  ["instagram", (l) => l.includes("instagram")],
  ["threads", (l) => l.includes("threads")],
  ["x", (l, h) => h === "t.co" || h === "x.com" || h.endsWith(".x.com") || l.includes("twitter")],
  ["reddit", (l) => l.includes("reddit")],
  ["youtube", (l, h) => l.includes("youtube") || h === "youtu.be"],
  ["tiktok", (l) => l.includes("tiktok") || l.includes("musically")],
  ["chatgpt", (l, h) => l.includes("chatgpt") || h === "chat.openai.com"],
  ["perplexity", (l) => l.includes("perplexity")],
];

function siteOf(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

/** Pure, so the rule has a test. `host` is this page's own. */
export function arrivalOf(input: { referrer: string | null | undefined; host: string }): Arrival {
  const referrer = (input.referrer ?? "").trim();
  if (!referrer) return "none";
  let from: string;
  try {
    from = siteOf(new URL(referrer).host);
  } catch {
    return "none";
  }
  if (!from) return "none";
  if (from === siteOf(input.host)) return "internal";
  const labels = from.split(".");
  for (const [arrival, matches] of RULES) {
    if (matches(labels, from)) return arrival;
  }
  return "external";
}

/** The same, read off this document; `none` wherever there is none to read. */
export function currentArrival(): Arrival {
  if (typeof window === "undefined" || typeof document === "undefined") return "none";
  try {
    return arrivalOf({ referrer: document.referrer, host: window.location.host });
  } catch {
    return "none";
  }
}
