// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { QUIZ_COPY, quizCardCopy } from "@/lib/quiz-copy";

/**
 * The quiz link's card in a group chat.
 *
 * `/q/[code]` is a server page for one reason — the unfurl — and it has
 * shipped wrong twice. First with no `og:image`, because a segment's
 * `openGraph` replaces the root layout's wholesale and the root's image went
 * with it. Then with the *home page's* card: a nested `generateMetadata`
 * inherits every top-level key it does not set, `alternates` among them, so
 * the page carried `<link rel="canonical" href="https://www.guessong.app">`,
 * and Facebook resolves a canonical before it reads a card. The owner who
 * shared it saw the party-game title and the party-game picture with their
 * name nowhere. Nothing else in the suite reads this page's metadata (it is
 * `.tsx`, and vitest cannot import one here), so this reads the source, the
 * way tests/site-policy.test.ts reads the policy pages.
 *
 * The image is now rendered per quiz — the reversal of what this test used
 * to pin. It was rejected as `ƒ` on the most expensive render in the app,
 * paid once per unfurler per share; what changed is not the cost of a render
 * but where it is paid: the route sets an `s-maxage` of its own, so the edge
 * renders a quiz's card once a day per region rather than once per share.
 * That header is the whole of the argument, so it is what is pinned.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const QUIZ_PAGE = "app/q/[code]/page.tsx";
const QUIZ_IMAGE = "app/q/[code]/opengraph-image.tsx";

/**
 * The declaration, not the phrase: app/opengraph-image.tsx names
 * `runtime = "edge"` in the comment explaining why it must not have one.
 */
const EDGE_RUNTIME = /export\s+const\s+runtime\s*=\s*["']edge["']/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("the quiz link's unfurl", () => {
  const source = read(QUIZ_PAGE);

  it("pins the card to its own URL: a self-canonical and og:url, on the found branch", () => {
    // Without `alternates` of its own the page inherits the root layout's
    // canonical — the home page — and Facebook unfurls *that*. The URL is
    // built from the peek's canonical code, never the segment.
    expect(source).toMatch(/const url = `\/q\/\$\{peek\.code\}`/);
    expect(source).toMatch(/alternates:\s*\{\s*canonical:\s*url\s*\}/);
    expect(source).toMatch(/openGraph:\s*\{[^}]*\burl\b/);
  });

  it("drops the inherited canonical on the fallback branch too, without inventing one", () => {
    // A quiz that is gone still must not unfurl as the home page. `null`
    // removes the root's canonical and the hreflang set with it; a canonical
    // to a junk segment would be a URL that never resolves.
    expect(source).toMatch(/alternates:\s*\{\s*canonical:\s*null\s*\}/);
    // And the fallback card is quiz-shaped, not the party game's.
    expect(source).toMatch(/ogFallbackTitle/);
    expect(source).toMatch(/ogFallbackDescription/);
  });

  it("asks Twitter for the large card on both branches", () => {
    // `summary` draws a thumbnail beside the text; `summary_large_image` is
    // the card the root layout already asks for.
    const large = source.match(/card:\s*"summary_large_image"/g) ?? [];
    expect(large).toHaveLength(2);
    expect(source).not.toMatch(/card:\s*"summary"/);
  });

  it("names no image in its metadata: the sibling file convention supplies it", () => {
    // Next attaches `opengraph-image.tsx` to the segment's `openGraph` and
    // `twitter` itself, and file-based metadata outranks config. An `images`
    // entry here would either duplicate it or, pointing at the static site
    // card, put the party game back on the quiz's card.
    expect(source).not.toMatch(/images/);
    expect(source).not.toMatch(/\/opengraph-image/);
  });

  it("relies on the root layout's metadataBase to make the image URL absolute", () => {
    // A relative image URL in a nested segment resolves against the base the
    // root layout declares — Next inherits it — and an unfurler is handed
    // `https://www.guessong.app/q/…/opengraph-image`. Drop the base and every
    // card on the site loses its image, not only this one.
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/metadataBase:\s*new URL\(BASE_URL\)/);
    expect(layout).toMatch(/https:\/\/www\.guessong\.app/);
  });
});

describe("the per-quiz card image", () => {
  const image = read(QUIZ_IMAGE);

  it("is the segment's opengraph-image, on the Node runtime", () => {
    expect(existsSync(join(process.cwd(), QUIZ_IMAGE))).toBe(true);
    // Edge would not make it static — nothing can — and would drop the Node
    // fetch the CJK font loading needs. The same for everything under /q.
    for (const file of walk(join(process.cwd(), "app/q")).filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(EDGE_RUNTIME);
    }
    expect(image).toMatch(/export const size = \{ width: 1200, height: 630 \}/);
    expect(image).toMatch(/export const contentType = "image\/png"/);
  });

  it("sets its own edge cache header, lower-case, longer for a quiz than for a miss", () => {
    // This header is why a per-quiz render is affordable: `s-maxage` is what
    // Vercel's edge honours, and ImageResponse's own `immutable, max-age`
    // only ever cached the picture in a browser an unfurler is not. The key
    // must be lower-case — ImageResponse spreads caller headers over its own
    // lower-case defaults, and `Headers` would *append* a capitalised twin.
    expect(image).toMatch(/"cache-control":/);
    expect(image).not.toMatch(/"Cache-Control"/);
    const found = Number(image.match(/FOUND_CACHE_CONTROL = "[^"]*s-maxage=(\d+)/)?.[1]);
    const missing = Number(image.match(/MISSING_CACHE_CONTROL = "[^"]*s-maxage=(\d+)/)?.[1]);
    expect(found).toBeGreaterThanOrEqual(60 * 60);
    expect(missing).toBeLessThanOrEqual(5 * 60);
    expect(found).toBeGreaterThan(missing);
    expect(image).toMatch(/peek \? FOUND_CACHE_CONTROL : MISSING_CACHE_CONTROL/);
  });

  it("renders no emoji: each one is a fetch on every uncached render", () => {
    expect(image).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("takes its words from lib/quiz-copy.ts, in the owner's language", () => {
    expect(image).toMatch(/quizCardCopy\(/);
    const zh = quizCardCopy({ locale: "zh", ownerName: "小明", playlistName: "深夜", questionCount: 20 });
    expect(zh.title).toBe("你有多懂 小明 的音樂品味？");
    expect(zh.subtitle).toBeNull();
    expect(zh.pills).toEqual(["共 20 題", QUIZ_COPY.zh.ogRule]);
    expect(zh.label).toBe(QUIZ_COPY.zh.ogQuizLabel);

    // No owner: the title asks about "this playlist", so the playlist is named.
    const en = quizCardCopy({ locale: "en", ownerName: null, playlistName: "Late nights", questionCount: 10 });
    expect(en.title).toBe(QUIZ_COPY.en.introTitlePlaylist);
    expect(en.subtitle).toBe("Late nights");
    expect(en.pills[0]).toBe("10 questions");

    // Could not be read: still a quiz, still not the party game, in English.
    const gone = quizCardCopy(null);
    expect(gone.title).toBe(QUIZ_COPY.en.ogFallbackTitle);
    expect(gone.subtitle).toBeNull();
    expect(gone.pills).toEqual([QUIZ_COPY.en.ogRule]);
    for (const locale of ["en", "zh"] as const) {
      for (const s of [QUIZ_COPY[locale].ogFallbackTitle, QUIZ_COPY[locale].ogRule, QUIZ_COPY[locale].ogQuizLabel]) {
        expect(s.toLowerCase()).not.toMatch(/party|派對|multiplayer|login/);
      }
    }
  });
});
