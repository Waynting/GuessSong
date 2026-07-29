import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /buzz and /j are ephemeral room codes — nothing to index, and crawling
      // them just burns budget on pages that 404 once the room's TTL expires.
      disallow: ["/game", "/api/", "/share", "/buzz", "/j"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
