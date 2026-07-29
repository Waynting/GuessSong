import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

// Every URL in a language cluster has to carry the full annotation set —
// a one-sided declaration is a weaker signal than none.
const LANGUAGE_ALTERNATES = {
  en: BASE_URL,
  "zh-TW": `${BASE_URL}/zh`,
  "x-default": BASE_URL,
};

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
      alternates: { languages: LANGUAGE_ALTERNATES },
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/zh`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: LANGUAGE_ALTERNATES },
    },
  ];
}
