/**
 * Every indexable page sets its own social card, with a picture.
 *
 * Next merges metadata shallowly, so a page that sets no `openGraph` shares
 * as the home page (url, title and all), and a page that sets one loses the
 * root's image. Both shipped: the five policy pages unfurled as the home
 * page, and `/about`, `/guides`, `/zh` and every guide unfurled with no
 * picture and the home page's English `twitter:title`. Nothing on screen
 * shows either — only a link pasted into a chat does.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { socialMetadata, SITE_CARD_IMAGE } from "@/lib/page-metadata";
import { guideMetadata, GUIDES } from "@/lib/guides";
import { POLICY_LAST_UPDATED, POLICY_LAST_UPDATED_ISO } from "@/lib/legal";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const VIA_HELPER = [
  "app/about/page.tsx",
  "app/guides/page.tsx",
  "app/zh/page.tsx",
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
  "app/contact/page.tsx",
  "app/zh/privacy/page.tsx",
  "app/zh/terms/page.tsx",
];

describe("social cards", () => {
  it("always sets both blocks, with the url and the site card", () => {
    const card = socialMetadata({ path: "/x", title: "T", description: "D" });
    expect(card.openGraph).toMatchObject({ url: "/x", title: "T", description: "D", type: "website" });
    expect(card.openGraph?.images).toEqual([SITE_CARD_IMAGE]);
    expect(card.twitter).toMatchObject({ title: "T", description: "D", card: "summary_large_image" });
    expect(card.twitter?.images).toEqual([SITE_CARD_IMAGE]);
  });

  it("is what every content page's metadata goes through, with its own path", () => {
    for (const page of VIA_HELPER) {
      const src = read(page);
      const path = page === "app/zh/page.tsx" ? "/zh" : page.replace(/^app/, "").replace(/\/page\.tsx$/, "");
      expect(src, page).toMatch(new RegExp(`socialMetadata\\(\\{\\s*path:\\s*"${path}"`));
      expect(src, `${page} sets openGraph by hand beside the helper`).not.toMatch(/\bopenGraph:\s*\{/);
    }
  });

  it("puts the Chinese pages' cards in Chinese", () => {
    for (const page of ["app/zh/page.tsx", "app/zh/privacy/page.tsx", "app/zh/terms/page.tsx"]) {
      expect(read(page), page).toMatch(/locale:\s*"zh_TW"/);
    }
  });

  it("gives every guide an article card with a picture", () => {
    for (const guide of GUIDES) {
      const meta = guideMetadata(guide.slug);
      expect(meta.openGraph).toMatchObject({ type: "article", url: `/guides/${guide.slug}` });
      expect(meta.openGraph?.images).toEqual([SITE_CARD_IMAGE]);
      expect(meta.twitter?.title).toBe(guide.title);
    }
  });

  it("gives /quiz a picture and its own twitter card", () => {
    const quiz = read("app/quiz/page.tsx");
    expect(quiz).toMatch(/openGraph:\s*\{[\s\S]*?images:\s*\["\/opengraph-image"\]/);
    expect(quiz).toMatch(/twitter:\s*\{[\s\S]*?images:\s*\["\/opengraph-image"\]/);
  });
});

describe("sitemap dates", () => {
  it("never stamps a page with the build's own time", () => {
    expect(read("app/sitemap.ts")).not.toMatch(/new Date\(\)/);
  });

  it("dates the policy pages from the day the pages themselves print", () => {
    expect(new Date(POLICY_LAST_UPDATED_ISO).toISOString().slice(0, 10)).toBe(POLICY_LAST_UPDATED_ISO);
    expect(new Date(`${POLICY_LAST_UPDATED} UTC`).toISOString().slice(0, 10)).toBe(POLICY_LAST_UPDATED_ISO);
  });
});

describe("pages nobody should index say so themselves", () => {
  it("drops the root canonical and sets noindex under every disallowed prefix", () => {
    for (const layout of ["app/share/layout.tsx", "app/buzz/layout.tsx", "app/j/layout.tsx", "app/game/layout.tsx"]) {
      const src = read(layout);
      expect(src, layout).toMatch(/index:\s*false/);
      expect(src, layout).toMatch(/canonical:\s*null/);
    }
  });
});
