import Link from "next/link";
import { SiteFooter, type FooterLocale } from "@/components/site-footer";

/**
 * Page chrome for everything on this site that is prose rather than product —
 * `/guides/*`, `/privacy`, `/terms`, `/contact`.
 *
 * The two existing landing pages each carry their own ~250-line `<style>`
 * block, which is fine for two pages that look nothing alike and unworkable
 * for a dozen that must look identical. Everything here is a plain server
 * component with no client boundary: these pages are static text, and pulling
 * React state into them would cost a bundle for nothing.
 *
 * The typography deliberately matches the landing pages (Bebas Neue display,
 * Outfit body, #111 ground, #1DB954 accent) so a reader who arrives on a guide
 * from search does not feel like they landed on a different site.
 */
export interface ArticleShellProps {
  /** The `<h1>`. Written as the page's own title, not the site's. */
  title: string;
  /** One or two sentences under the title. Renders as an `<h2>`-weight lede. */
  lede?: string;
  /** Small label above the title — section, category, or date. */
  eyebrow?: string;
  /** Rendered under the lede, before the prose. Meant for a "last updated" line. */
  meta?: string;
  locale?: FooterLocale;
  /** Where the back link at the top points, and what it says. */
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
}

export function ArticleShell({
  title,
  lede,
  eyebrow,
  meta,
  locale = "en",
  backHref = "/",
  backLabel = "← GuessSong",
  children,
}: ArticleShellProps) {
  return (
    <>
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

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Outfit', sans-serif;
        }

        .article-main {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 20px 0;
        }
        .article-col {
          width: 100%;
          max-width: 720px;
        }

        .article-back {
          display: inline-block;
          color: var(--muted);
          font-size: 13px;
          text-decoration: none;
          margin-bottom: 32px;
          transition: color 0.15s ease;
        }
        .article-back:hover { color: var(--green); }

        .article-eyebrow {
          color: var(--green);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .article-h1 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(2.2rem, 6vw, 3.6rem);
          line-height: 1;
          letter-spacing: 0.02em;
          margin-bottom: 16px;
        }
        .article-lede {
          color: var(--muted);
          font-size: 17px;
          font-weight: 300;
          line-height: 1.65;
          margin-bottom: 12px;
        }
        .article-meta {
          color: #666;
          font-size: 12.5px;
          font-weight: 300;
          padding-bottom: 28px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 36px;
        }

        /* --- Prose --- */
        .article-body h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(1.5rem, 3.5vw, 2rem);
          line-height: 1.1;
          letter-spacing: 0.03em;
          margin: 44px 0 14px;
          scroll-margin-top: 24px;
        }
        .article-body h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 28px 0 8px;
          color: var(--text);
        }
        .article-body p {
          color: #c8c8c8;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.75;
          margin-bottom: 16px;
        }
        .article-body ul, .article-body ol {
          margin: 0 0 18px;
          padding-left: 22px;
          color: #c8c8c8;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.75;
        }
        .article-body li { margin-bottom: 8px; }
        .article-body li::marker { color: var(--green); }
        .article-body strong { color: var(--text); font-weight: 600; }
        .article-body a { color: var(--green); text-decoration: none; }
        .article-body a:hover { text-decoration: underline; }
        .article-body code {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 5px;
          padding: 1px 6px;
          font-size: 13.5px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #e6e6e6;
        }
        .article-body hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 40px 0;
        }
        .article-body blockquote {
          border-left: 2px solid var(--green);
          padding: 2px 0 2px 16px;
          margin: 0 0 18px;
          color: var(--muted);
          font-style: italic;
        }
        .article-body table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 14.5px;
          font-weight: 300;
        }
        .article-body th, .article-body td {
          border: 1px solid var(--border);
          padding: 9px 12px;
          text-align: left;
          color: #c8c8c8;
        }
        .article-body th {
          background: var(--surface);
          color: var(--text);
          font-weight: 600;
        }

        .callout {
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 2px solid var(--green);
          border-radius: 10px;
          padding: 16px 20px;
          margin: 0 0 20px;
        }
        .callout p:last-child { margin-bottom: 0; }
        .callout-title {
          font-weight: 600;
          font-size: 14px;
          color: var(--text);
          margin-bottom: 6px;
        }

        .article-cta {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 26px 24px;
          text-align: center;
          margin: 44px 0 8px;
        }
        .article-cta p { margin-bottom: 16px; }
        /* Selector-qualified because the CTA sits *inside* .article-body, and
           ".article-body a" (0,1,1) outranks a bare ".cta-primary" (0,1,0) —
           which paints the label green on a green pill, i.e. invisible. */
        .cta-primary,
        .article-body a.cta-primary {
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
        .cta-primary:hover,
        .article-body a.cta-primary:hover { background: #1ed760; text-decoration: none; }

        .link-btn {
          color: var(--muted);
          font-size: 13px;
          text-decoration: none;
        }
        .link-btn:hover { color: var(--green); }
      `}</style>

      <main className="article-main">
        <div className="article-col">
          <Link href={backHref} className="article-back">
            {backLabel}
          </Link>

          <article>
            <header>
              {eyebrow && <p className="article-eyebrow">{eyebrow}</p>}
              <h1 className="article-h1">{title}</h1>
              {lede && <p className="article-lede">{lede}</p>}
              {meta && <p className="article-meta">{meta}</p>}
            </header>
            <div className="article-body">{children}</div>
          </article>

          <SiteFooter locale={locale} />
        </div>
      </main>
    </>
  );
}
