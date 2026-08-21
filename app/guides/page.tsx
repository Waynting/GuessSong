import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import {
  GUIDES,
  GUIDE_CATEGORIES,
  guidesByCategory,
  type GuideCategory,
} from "@/lib/guides";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export const metadata: Metadata = {
  title: "Guides — Music Quiz Hosting, Playlists and Troubleshooting",
  description:
    "How to host a music quiz night, pick a playlist that plays well, set the right clip length, score a game so it stays close, and fix a Spotify playlist that will not load.",
  alternates: { canonical: "/guides" },
  openGraph: {
    type: "website",
    url: `${BASE_URL}/guides`,
    title: "GuessSong Guides",
    description:
      "Everything we have learned about running a music guessing game — hosting, playlists, scoring, and the technical bits that break.",
  },
};

// Keyed by the union, not by string: a new GuideCategory with no blurb here
// must be a compile error, not an `undefined` rendered under the heading.
// Same rule lib/error-messages.ts follows for its translation table.
const CATEGORY_BLURB: Record<GuideCategory, string> = {
  Playing: "The game itself — playlists, difficulty, scoring, and the modes worth knowing.",
  Hosting: "Running the evening: length, seating, sound, and the mistakes that flatten a good night.",
  Troubleshooting: "When something does not work, and why. Mostly Spotify's fault, honestly.",
};

export default function GuidesIndexPage() {
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "GuessSong Guides",
    itemListElement: GUIDES.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}/guides/${g.slug}`,
      name: g.title,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');

        :root {
          --green: #1DB954;
          --bg: #111111;
          --surface: #1a1a1a;
          --border: #2a2a2a;
          --text: #f0f0f0;
          --muted: #999;
        }
        body { background: var(--bg); color: var(--text); font-family: 'Outfit', sans-serif; }

        .guides-main {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 20px 0;
        }
        .guides-col { width: 100%; max-width: 760px; }

        .guides-back {
          display: inline-block;
          color: var(--muted);
          font-size: 13px;
          text-decoration: none;
          margin-bottom: 32px;
        }
        .guides-back:hover { color: var(--green); }

        .guides-eyebrow {
          color: var(--green);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .guides-h1 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(2.4rem, 7vw, 4rem);
          line-height: 1;
          letter-spacing: 0.02em;
          margin-bottom: 16px;
        }
        .guides-lede {
          color: var(--muted);
          font-size: 17px;
          font-weight: 300;
          line-height: 1.65;
          max-width: 580px;
          padding-bottom: 28px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 8px;
        }

        .guides-section { margin-top: 48px; }
        .guides-section-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(1.5rem, 3.5vw, 2rem);
          letter-spacing: 0.03em;
          line-height: 1;
          margin-bottom: 6px;
        }
        .guides-section-blurb {
          color: #777;
          font-size: 14px;
          font-weight: 300;
          margin-bottom: 18px;
        }

        .guide-card {
          display: block;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px 22px;
          margin-bottom: 12px;
          text-decoration: none;
          transition: border-color 0.15s ease, transform 0.15s ease;
        }
        .guide-card:hover { border-color: var(--green); transform: translateY(-2px); }
        .guide-card-title {
          color: var(--text);
          font-size: 17px;
          font-weight: 600;
          line-height: 1.35;
          margin-bottom: 7px;
        }
        .guide-card-desc {
          color: #a0a0a0;
          font-size: 14px;
          font-weight: 300;
          line-height: 1.6;
          margin-bottom: 10px;
        }
        .guide-card-meta {
          color: #666;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.04em;
        }

        .guides-cta {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 28px 24px;
          text-align: center;
          margin-top: 52px;
        }
        .guides-cta p {
          color: #a0a0a0;
          font-size: 15px;
          font-weight: 300;
          line-height: 1.6;
          margin-bottom: 18px;
          max-width: 420px;
          margin-left: auto;
          margin-right: auto;
        }
        .cta-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--green);
          color: #000;
          font-weight: 600;
          font-size: 14.5px;
          padding: 11px 24px;
          border-radius: 999px;
          text-decoration: none;
        }
        .cta-primary:hover { background: #1ed760; }
        .link-btn { color: var(--muted); font-size: 13px; text-decoration: none; }
        .link-btn:hover { color: var(--green); }
      `}</style>

      <main className="guides-main">
        <div className="guides-col">
          <Link href="/" className="guides-back">← GuessSong</Link>

          <header>
            <p className="guides-eyebrow">Guides</p>
            <h1 className="guides-h1">How to run a music guessing game</h1>
            <p className="guides-lede">
              Everything we have worked out about making one of these evenings good — how to
              pick a playlist, how long a clip should be, how to score it so the last round
              still matters, and why Spotify keeps refusing your link.
            </p>
          </header>

          {GUIDE_CATEGORIES.map((category) => {
            const guides = guidesByCategory(category);
            if (guides.length === 0) return null;
            return (
              <section key={category} className="guides-section">
                <h2 className="guides-section-title">{category}</h2>
                <p className="guides-section-blurb">{CATEGORY_BLURB[category]}</p>
                {guides.map((guide) => (
                  <Link
                    key={guide.slug}
                    href={`/guides/${guide.slug}`}
                    className="guide-card"
                  >
                    <p className="guide-card-title">{guide.title}</p>
                    <p className="guide-card-desc">{guide.description}</p>
                    <p className="guide-card-meta">{guide.minutes} MIN READ</p>
                  </Link>
                ))}
              </section>
            );
          })}

          <section className="guides-cta">
            <p>
              All of this applies to any music quiz. If you want one that runs off a Spotify
              playlist with no login and nothing to install, that is what GuessSong is.
            </p>
            <Link href="/" className="cta-primary">Start a game →</Link>
          </section>

          <SiteFooter />
        </div>
      </main>
    </>
  );
}
