import Link from "next/link";
import { ArticleShell } from "@/components/article-shell";
import { formatGuideDate, requireGuide, relatedGuides } from "@/lib/guides";

/**
 * The wrapper every article under `/guides` renders inside.
 *
 * An article file is then a slug plus its prose — the title, description,
 * canonical, dateline, Article JSON-LD, "read next" block and closing CTA are
 * all derived from that one slug via `lib/guides.ts`. Eight articles each
 * hand-rolling those is eight chances for the `<title>` and the `<h1>` to drift
 * apart, or for one article to quietly ship without structured data.
 *
 * The metadata half of that derivation lives in `lib/guides.ts`, not here, for
 * the reason `lib/song-count.ts` gives: the test suite only reaches `lib/`, and
 * a `.tsx` module cannot be imported from it. What stays here is the part that
 * is actually JSX.
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export { guideMetadata } from "@/lib/guides";

export function GuideShell({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const guide = requireGuide(slug);
  const related = relatedGuides(slug);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.published,
    inLanguage: "en",
    author: { "@type": "Organization", name: "GuessSong", url: BASE_URL },
    publisher: { "@type": "Organization", name: "GuessSong", url: BASE_URL },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${BASE_URL}/guides/${guide.slug}`,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <ArticleShell
        eyebrow={guide.category}
        title={guide.title}
        lede={guide.lede}
        meta={`${formatGuideDate(guide.published)} · ${guide.minutes} min read`}
        backHref="/guides"
        backLabel="← All guides"
      >
        {children}

        <div className="article-cta">
          <p>
            GuessSong turns any public Spotify playlist into this game. No login, no app,
            no sign-up.
          </p>
          <Link href="/" className="cta-primary">
            Start a game →
          </Link>
        </div>

        {related.length > 0 && (
          <section aria-labelledby="read-next">
            <h2 id="read-next">Read next</h2>
            <ul>
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/guides/${r.slug}`}>{r.title}</Link> — {r.description}
                </li>
              ))}
            </ul>
          </section>
        )}
      </ArticleShell>
    </>
  );
}
