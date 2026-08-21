// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The policy pages and the footer that links to them.
 *
 * These exist because an ad network's site review — and a visitor looking for
 * who to complain to — both start at the footer. The failure they guard is not
 * a crash: a page that quietly stops linking to the privacy policy still
 * renders, still passes a build, and reads to a reviewer exactly like a site
 * that does not have one. Nothing else in the suite would notice.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const POLICY_PAGES = [
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
  "app/contact/page.tsx",
  "app/zh/privacy/page.tsx",
  "app/zh/terms/page.tsx",
];

describe("policy pages", () => {
  it("all exist", () => {
    for (const page of POLICY_PAGES) {
      expect(existsSync(join(process.cwd(), page)), `${page} is missing`).toBe(true);
    }
  });

  it("each declares its own metadata", () => {
    // Without one, every policy page inherits the homepage title and canonical
    // from the root layout — three pages claiming to be "/" in search results.
    for (const page of POLICY_PAGES) {
      const source = read(page);
      expect(source, `${page} has no metadata export`).toContain("export const metadata");
      expect(source, `${page} declares no canonical`).toContain("canonical");
    }
  });

  it("declares each language pair on both sides", () => {
    // A one-sided hreflang is a weaker signal than none, the same rule
    // app/sitemap.ts follows for the / and /zh cluster.
    for (const [en, zh] of [
      ["app/privacy/page.tsx", "app/zh/privacy/page.tsx"],
      ["app/terms/page.tsx", "app/zh/terms/page.tsx"],
    ]) {
      for (const page of [en, zh]) {
        const source = read(page);
        expect(source, `${page} declares no language alternates`).toContain("languages");
      }
    }
  });
});

describe("privacy policy", () => {
  const en = read("app/privacy/page.tsx");
  const zh = read("app/zh/privacy/page.tsx");

  it("discloses the advertising and analytics that actually run", () => {
    // app/layout.tsx loads both. A policy that omits one is a policy that is
    // wrong, which is worse than not having written it down.
    for (const [name, source] of [["en", en], ["zh", zh]] as const) {
      expect(source, `${name} does not name AdSense`).toContain("AdSense");
      expect(source, `${name} does not name Analytics`).toContain("Analytics");
      expect(source.toLowerCase(), `${name} does not mention cookies`).toContain("cookie");
    }
  });

  it("gives readers a way to opt out of personalised advertising", () => {
    for (const source of [en, zh]) {
      expect(source).toContain("google.com/settings/ads");
    }
  });

  it("carries a contact address on both sides", () => {
    for (const source of [en, zh]) {
      expect(source).toContain("CONTACT_EMAIL");
    }
  });

  it("dates both sides from the same module", () => {
    // Two hand-kept dates drift, and a reviewer reads a mismatch as a page that
    // was quietly edited. lib/legal.ts is the single source.
    expect(en).toContain("POLICY_LAST_UPDATED");
    expect(zh).toContain("POLICY_LAST_UPDATED_ZH");
  });
});

describe("terms", () => {
  const en = read("app/terms/page.tsx");
  const zh = read("app/zh/terms/page.tsx");

  it("disclaims affiliation with the services the game reads from", () => {
    // Using these names to describe what the game does is fine; implying a
    // relationship is not, and it is the kind of thing a rewrite drops.
    for (const source of [en, zh]) {
      expect(source).toContain("Spotify AB");
      expect(source).toContain("Deezer");
    }
  });
});

describe("site footer", () => {
  const footer = read("components/site-footer.tsx");

  it("links to the policy pages in both locales", () => {
    for (const href of ["/privacy", "/terms", "/contact", "/zh/privacy", "/zh/terms"]) {
      expect(footer, `footer does not link to ${href}`).toContain(`"${href}"`);
    }
  });

  it("links to the guides", () => {
    expect(footer).toContain('"/guides"');
  });

  it("is the footer every public page renders", () => {
    // The three landing pages each had their own <footer> before this; the
    // whole point of the shared one is that a page cannot lose the policy links
    // by being edited on its own.
    for (const page of ["app/page.tsx", "app/about/page.tsx", "app/zh/page.tsx"]) {
      expect(read(page), `${page} does not render SiteFooter`).toContain("SiteFooter");
    }
  });

  it("keeps the Chinese footer in Chinese", () => {
    // /zh is written natively rather than translated — an English label leaking
    // into its footer is a visible defect, not a fallback. Same rule as
    // lib/changelog.ts.
    const zhBlock = footer.slice(footer.indexOf("zh: ["), footer.indexOf("];", footer.indexOf("zh: [")));
    expect(zhBlock).toContain("隱私權政策");
    expect(zhBlock).toContain("服務條款");
    expect(zhBlock).not.toContain("Privacy");
  });
});

describe("robots", () => {
  const robots = read("app/robots.ts");

  it("does not disallow the content pages", () => {
    // The disallow list is for ephemeral rooms and the counting redirect. A
    // guide or a policy page landing in it would be invisible to exactly the
    // crawler it was written for.
    const disallowed = robots.slice(robots.indexOf("disallow:"), robots.indexOf("]", robots.indexOf("disallow:")));
    for (const path of ["/guides", "/privacy", "/terms", "/contact"]) {
      expect(disallowed, `robots.ts disallows ${path}`).not.toContain(`"${path}"`);
    }
  });
});
