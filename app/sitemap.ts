import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

// Every URL in a language cluster has to carry the full annotation set —
// a one-sided declaration is a weaker signal than none.
const LANGUAGE_ALTERNATES = {
  en: BASE_URL,
  "zh-TW": `${BASE_URL}/zh`,
  "x-default": BASE_URL,
};

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const core: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 1,
      alternates: { languages: LANGUAGE_ALTERNATES },
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/zh`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: LANGUAGE_ALTERNATES },
    },
    {
      url: `${BASE_URL}/guides`,
      lastModified: now,
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
  const policy: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
      alternates: {
        languages: {
          en: `${BASE_URL}/privacy`,
          "zh-TW": `${BASE_URL}/zh/privacy`,
          "x-default": `${BASE_URL}/privacy`,
        },
      },
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
      alternates: {
        languages: {
          en: `${BASE_URL}/terms`,
          "zh-TW": `${BASE_URL}/zh/terms`,
          "x-default": `${BASE_URL}/terms`,
        },
      },
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/zh/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/zh/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];

  return [...core, ...guides, ...policy];
}
