import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /buzz and /j are ephemeral room codes — nothing to index, and crawling
      // them just burns budget on pages that 404 once the room's TTL expires.
      //
      // /r is the loop redirect. It has no content to index, and every fetch of
      // it increments a counter — so a crawler, or the link unfurler in
      // whichever chat app a result card lands in, would report clicks nobody
      // made. Robots is a request rather than a guarantee, which is part of why
      // the counter is only ever read as a floor.
      disallow: ["/game", "/api/", "/share", "/buzz", "/j", "/r"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
