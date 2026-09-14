// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The quiz link's card in a group chat.
 *
 * `/q/[code]` is a server page for one reason — the unfurl — and it shipped
 * with `og:title`, `og:description` and no `og:image`, because a segment's
 * `openGraph` replaces the root layout's wholesale and the root's image went
 * with it. LINE, WhatsApp and iMessage all draw a text-only card for that,
 * and the link in a group chat is the feature's whole distribution. Nothing
 * else in the suite reads this page's metadata (it is `.tsx`, and vitest
 * cannot import one here), so this reads the source, the way
 * tests/site-policy.test.ts reads the policy pages.
 *
 * The other half is what the image must *not* be: a per-quiz satori render.
 * That would be `ƒ` — run once per unfurler per share on the most expensive
 * render in the app — which CLAUDE.md's "SEO / Metadata" section explains
 * at length. The static `/opengraph-image` is built once and costs every
 * unfurler nothing, so the card reuses it.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const QUIZ_PAGE = "app/q/[code]/page.tsx";

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

  it("declares the site's static card as the OpenGraph image, with its size and an alt", () => {
    // Everything an unfurler wants: the URL, so it draws a card at all; the
    // dimensions, so it draws it before fetching; the alt, so it is described.
    expect(source).toMatch(/url:\s*"\/opengraph-image"/);
    expect(source).toMatch(/width:\s*1200/);
    expect(source).toMatch(/height:\s*630/);
    expect(source).toMatch(/alt:\s*title/);
    expect(source).toMatch(/openGraph:\s*\{[^}]*images/);
  });

  it("asks Twitter for the large card and hands it the same image", () => {
    // `summary` draws a thumbnail beside the text; `summary_large_image` is
    // the card the root layout already asks for.
    expect(source).toMatch(/twitter:\s*\{[^}]*card:\s*"summary_large_image"/);
    expect(source).toMatch(/twitter:\s*\{[^}]*images/);
    expect(source).not.toMatch(/card:\s*"summary"/);
  });

  it("relies on the root layout's metadataBase to make the image URL absolute", () => {
    // A relative `/opengraph-image` in a nested `generateMetadata` resolves
    // against the base the root layout declares — Next inherits it — and an
    // unfurler is handed `https://www.guessong.app/opengraph-image`. Drop the
    // base and every card on the site loses its image, not only this one.
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/metadataBase:\s*new URL\(BASE_URL\)/);
    expect(layout).toMatch(/https:\/\/www\.guessong\.app/);
    // And the image the quiz names is the one the root declares, so the two
    // cannot drift apart: one build-time route, referenced twice.
    expect(layout).toMatch(/url:\s*"\/opengraph-image",\s*width:\s*1200,\s*height:\s*630/);
  });

  it("renders no image of its own: the card is the build-time route, never a per-quiz satori render", () => {
    // A `/q/[code]/opengraph-image.tsx` would be a dynamic route rendered on
    // every unfurl of every share, and the same for anything under /q that
    // opts into the edge runtime — the regression CLAUDE.md warns about, and
    // the one nothing on screen would reveal.
    const under = walk(join(process.cwd(), "app/q"));
    const generated = under.filter((f) => /(opengraph-image|twitter-image)\.(tsx?|jsx?)$/.test(f));
    expect(generated, generated.join("\n")).toEqual([]);
    for (const file of under.filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(EDGE_RUNTIME);
    }
    // The route it does reuse exists and is itself static.
    expect(existsSync(join(process.cwd(), "app/opengraph-image.tsx"))).toBe(true);
    expect(read("app/opengraph-image.tsx")).not.toMatch(EDGE_RUNTIME);
  });
});
