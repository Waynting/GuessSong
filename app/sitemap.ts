import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";
import { POLICY_LAST_UPDATED_ISO } from "@/lib/legal";

/**
 * When each page's *content* last changed, by hand. This was the build's clock on
 * every entry, which told crawlers every page changed on every deploy — and a
 * date that always moves is a date a crawler learns to ignore, including on
 * the day it is true. Bump the one that matches the page you edited.
 */
const LANDING_UPDATED = "2026-10-01";
const ABOUT_UPDATED = "2026-09-15";
const QUIZ_UPDATED = "2026-10-03";
const CONTACT_UPDATED = "2026-08-21";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

type Entry = MetadataRoute.Sitemap[number];
type EntryOptions = Pick<Entry, "changeFrequency" | "priority" | "lastModified">;

/**
 * Both halves of a language pair, annotated identically.
 *
 * Every URL in a language cluster has to carry the full annotation set — a
 * one-sided declaration is a weaker signal than none. That rule was written at
 * the top of this file and then broken three entries below it in 1.7.0: the
 * policy pages got `en`/`zh-TW`/`x-default` on the English half and nothing at
 * all on the `/zh` half, because the two were typed out separately.
 *
 * So a cluster is one call now. The annotation set is computed once and handed
 * to both halves, which makes writing one side without the other impossible
 * rather than merely discouraged. `tests/guides.test.ts` asserts the property
 * from the other direction — every alternate a sitemap entry names must itself
 * be in the sitemap, carrying the identical set.
 */
function languageCluster(
  enPath: string,
  zhPath: string,
  options: EntryOptions,
  zhOverrides: Partial<EntryOptions> = {}
): MetadataRoute.Sitemap {
  const en = `${BASE_URL}${enPath}`;
  const zh = `${BASE_URL}${zhPath}`;
  // x-default points at the English half: it is the canonical entry point and
  // the one `app/layout.tsx` already names.
  const languages = { en, "zh-TW": zh, "x-default": en };

  return [
    { url: en, ...options, alternates: { languages } },
    { url: zh, ...options, ...zhOverrides, alternates: { languages } },
  ];
}

export default function sitemap(): MetadataRoute.Sitemap {
  // The index changes when a guide is added, so it is as new as the newest.
  const guidesUpdated = new Date(
    GUIDES.reduce((latest, g) => (g.published > latest ? g.published : latest), GUIDES[0].published)
  );

  // The landing pair. /zh keeps its slightly lower priority — it is the same
  // content for a smaller audience, not a different page.
  const landing = languageCluster(
    "",
    "/zh",
    { lastModified: new Date(LANDING_UPDATED), changeFrequency: "monthly", priority: 1 },
    { priority: 0.9 }
  );

  const core: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date(ABOUT_UPDATED),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    // The quiz's own page. English only, like the guides; no cluster.
    {
      url: `${BASE_URL}/quiz`,
      lastModified: new Date(QUIZ_UPDATED),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guides`,
      lastModified: guidesUpdated,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  // Derived from lib/guides.ts rather than listed again. A guide that shipped
  // but never reached the sitemap is a page Google does not come back for, and
  // nothing on screen would say so — same hand-sync failure lib/loop-links.ts
  // is shaped to avoid.
  const guides: MetadataRoute.Sitemap = GUIDES.map((guide) => ({
    url: `${BASE_URL}/guides/${guide.slug}`,
    lastModified: new Date(guide.published),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // Policy pages are low priority but must be crawlable and discoverable: an
  // ad network's site review looks for them, and a page it cannot find reads
  // exactly like a page that does not exist.
  const policyOptions: EntryOptions = {
    lastModified: new Date(POLICY_LAST_UPDATED_ISO),
    changeFrequency: "yearly",
    priority: 0.4,
  };

  const policy: MetadataRoute.Sitemap = [
    ...languageCluster("/privacy", "/zh/privacy", policyOptions),
    ...languageCluster("/terms", "/zh/terms", policyOptions),
    // English only — there is one inbox behind it, and both footers point here.
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(CONTACT_UPDATED),
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];

  return [...landing, ...core, ...guides, ...policy];
}
