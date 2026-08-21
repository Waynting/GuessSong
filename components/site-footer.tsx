import Link from "next/link";
import { CONTACT_EMAIL, REPORT_PROBLEM_MAILTO } from "@/lib/contact";
import { ChangelogModal } from "@/components/changelog-modal";

/**
 * The site-wide footer, and the only place the policy pages are linked from.
 *
 * That last part is the reason it exists as a shared component rather than the
 * three hand-rolled `<footer>` blocks it replaces. A reviewer — Google's or a
 * player's — looks for the privacy policy in the footer, and a page that omits
 * it reads as a page that does not have one. Three copies of a link list is
 * three chances for one page to quietly stop carrying the link, which is the
 * same hand-sync failure `lib/loop-links.ts` is shaped to avoid.
 *
 * `locale` swaps the labels and points the links at the `/zh` half of each
 * pair. It is not a translation layer: the Chinese strings are written for a
 * Chinese reader the same way `/zh` itself is, per the note in `lib/changelog.ts`.
 */
export type FooterLocale = "en" | "zh";

const GITHUB_URL = "https://github.com/Waynting/GuessSong";

interface FooterLink {
  href: string;
  label: string;
  /** Set for links that leave the site. */
  external?: boolean;
}

const LINKS: Record<FooterLocale, FooterLink[]> = {
  en: [
    { href: "/", label: "Play" },
    { href: "/about", label: "How to play" },
    { href: "/guides", label: "Guides" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
    { href: "/contact", label: "Contact" },
    { href: GITHUB_URL, label: "GitHub", external: true },
  ],
  zh: [
    { href: "/zh", label: "開始遊戲" },
    { href: "/guides", label: "遊戲指南" },
    { href: "/zh/privacy", label: "隱私權政策" },
    { href: "/zh/terms", label: "服務條款" },
    { href: "/contact", label: "聯絡我們" },
    { href: GITHUB_URL, label: "GitHub", external: true },
  ],
};

const COPY: Record<FooterLocale, { report: string; tagline: string; alt: string; altHref: string }> = {
  en: {
    report: "Report a problem",
    tagline:
      "GuessSong is a free, open-source party game. It is not affiliated with, endorsed by, or connected to Spotify AB, Apple Inc. or Deezer.",
    alt: "中文",
    altHref: "/zh",
  },
  zh: {
    report: "回報問題",
    tagline:
      "GuessSong 是免費的開源團康遊戲，與 Spotify AB、Apple Inc.、Deezer 沒有任何從屬或合作關係。",
    alt: "English",
    altHref: "/",
  },
};

export function SiteFooter({ locale = "en" }: { locale?: FooterLocale }) {
  const links = LINKS[locale];
  const copy = COPY[locale];

  return (
    <footer className="site-footer">
      <style>{`
        .site-footer {
          width: 100%;
          margin-top: 48px;
          padding-top: 24px;
          border-top: 1px solid #2a2a2a;
          text-align: center;
          font-family: 'Outfit', sans-serif;
        }
        .site-footer-nav {
          display: flex;
          gap: 8px 18px;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .site-footer-nav a,
        .site-footer-nav button {
          color: #999;
          font-size: 13px;
          font-weight: 400;
          text-decoration: none;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          font-family: inherit;
          transition: color 0.15s ease;
        }
        .site-footer-nav a:hover,
        .site-footer-nav button:hover { color: #1DB954; }
        .site-footer-meta {
          display: flex;
          gap: 8px 14px;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .site-footer-tagline {
          color: #555;
          font-size: 11.5px;
          font-weight: 300;
          line-height: 1.7;
          max-width: 560px;
          margin: 0 auto;
          padding-bottom: 24px;
        }
        .site-footer-sep { color: #333; }
      `}</style>

      <nav className="site-footer-nav" aria-label={locale === "zh" ? "頁尾導覽" : "Footer"}>
        {links.map((link) =>
          link.external ? (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          ) : (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          )
        )}
        <Link href={copy.altHref}>{copy.alt}</Link>
      </nav>

      <div className="site-footer-meta">
        <a href={REPORT_PROBLEM_MAILTO} className="link-btn">
          {copy.report}
        </a>
        <span aria-hidden className="site-footer-sep">·</span>
        <ChangelogModal locale={locale} />
      </div>

      <p className="site-footer-tagline">
        {copy.tagline}
        <br />
        © 2026 GuessSong · {CONTACT_EMAIL}
      </p>
    </footer>
  );
}
