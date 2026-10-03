import type { Metadata } from "next";

/**
 * The social card for a content page: `openGraph` and `twitter`, built from
 * one title and one description.
 *
 * Next merges metadata *shallowly*: a page that sets `openGraph` replaces the
 * root layout's whole block, image included, and a page that does not set it
 * inherits the root's — `og:url`, title and description all naming the home
 * page. Both happened here. The policy pages set neither and shared as the
 * home page's card; `/about`, `/guides`, `/zh` and every guide set their own
 * `openGraph` and so shared with no picture, and their `twitter` tags were
 * the home page's English copy (on `/zh` too). One helper that always sets
 * both blocks, with the url and the site card's image, is what keeps a new
 * page from repeating either mistake. `tests/page-metadata.test.ts` pins that
 * every indexable page goes through it or sets the same fields itself.
 *
 * `/opengraph-image` is the build-time root card (app/opengraph-image.tsx);
 * naming it costs nothing at request time.
 */
export const SITE_CARD_IMAGE = "/opengraph-image";

export interface SocialCard {
  /** Path on this site, e.g. "/privacy". Resolved against `metadataBase`. */
  path: string;
  title: string;
  description: string;
  type?: "website" | "article";
  /** "zh_TW" on the Chinese half. */
  locale?: string;
  /** Article-only extras Next passes through. */
  publishedTime?: string;
}

export function socialMetadata(card: SocialCard): Pick<Metadata, "openGraph" | "twitter"> {
  const base = {
    url: card.path,
    title: card.title,
    description: card.description,
    siteName: "GuessSong",
    images: [SITE_CARD_IMAGE],
    ...(card.locale ? { locale: card.locale } : {}),
  };
  return {
    openGraph:
      card.type === "article"
        ? { ...base, type: "article", ...(card.publishedTime ? { publishedTime: card.publishedTime } : {}) }
        : { ...base, type: "website" },
    twitter: {
      card: "summary_large_image",
      title: card.title,
      description: card.description,
      images: [SITE_CARD_IMAGE],
    },
  };
}
