import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/game", "/api/", "/share"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
