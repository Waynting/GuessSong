import type { Metadata } from "next";
import Link from "next/link";
import { ArticleShell } from "@/components/article-shell";
import { CONTACT_EMAIL } from "@/lib/contact";
import { POLICY_LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms you accept by using GuessSong: what the game is, what it is not, how it relates to Spotify, iTunes and Deezer, and the limits of the service.",
  alternates: {
    canonical: "/terms",
    languages: { en: "/terms", "zh-TW": "/zh/terms", "x-default": "/terms" },
  },
};

export default function TermsPage() {
  return (
    <ArticleShell
      eyebrow="Legal"
      title="Terms of Use"
      lede="GuessSong is a free, open-source party game offered as-is. These are the terms you accept by using it."
      meta={`Last updated ${POLICY_LAST_UPDATED} · ${CONTACT_EMAIL}`}
      backHref="/"
    >
      <h2>1. What this service is</h2>
      <p>
        GuessSong is a free browser-based party game. You give it a link to a public
        Spotify playlist; it reads that playlist&rsquo;s track list, finds a short
        publicly available preview clip for each song, and plays those clips so the people
        in the room can guess the titles. There is nothing to install, no account to
        create and no charge.
      </p>
      <p>
        By using the site you agree to these terms. If you do not agree with them, do not
        use the site.
      </p>

      <h2>2. We are not Spotify</h2>
      <p>
        <strong>
          GuessSong is an independent project. It is not affiliated with, endorsed,
          sponsored or certified by Spotify AB, Apple Inc. or Deezer S.A.
        </strong>{" "}
        Spotify, iTunes and Deezer are trademarks of their respective owners and are used
        here only to describe what the game reads from.
      </p>
      <p>
        The site reads public playlist metadata through Spotify&rsquo;s public Web API,
        and preview clips through the public iTunes Search API and Deezer&rsquo;s public
        API. It does not download, store, host or redistribute any music. Clips stream
        directly from the provider that hosts them, and each provider&rsquo;s own terms
        apply to that playback. We do not remove, bypass or interfere with any technical
        protection measure.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          use the site for any unlawful purpose, or in any way that infringes someone
          else&rsquo;s rights;
        </li>
        <li>
          submit a playlist link you do not have the right to share, or submit content
          that is unlawful, abusive or hateful — including in the display names typed into
          a Mixed Playlist room, which other players will see;
        </li>
        <li>
          automate, scrape or otherwise send requests at a volume that degrades the
          service for other people, or attempt to circumvent the rate limits that exist to
          prevent exactly that;
        </li>
        <li>
          attempt to gain unauthorised access to the site, its infrastructure or the rooms
          created by other hosts, including by guessing room codes;
        </li>
        <li>
          use the site to reproduce, perform or distribute music in a way that requires a
          licence you do not hold. A private game night among friends and a public
          performance are not the same thing, and only you know which one you are running.
        </li>
      </ul>

      <h2>4. Rooms and player-submitted content</h2>
      <p>
        Mixed Playlist Mode lets other people submit playlist links and display names into
        a room you host. That content belongs to whoever submitted it; we do not claim
        ownership of it and we do not moderate it. Rooms are temporary and expire
        automatically. If something inappropriate appears in a room, the host can simply
        stop the game — and the room will delete itself regardless.
      </p>

      <h2>5. Availability, and the things that break</h2>
      <p>
        The service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as
        available&rdquo;</strong>, without warranties of any kind, express or implied,
        including merchantability, fitness for a particular purpose and non-infringement.
        Specifically, and to be honest about the failure modes we already know:
      </p>
      <ul>
        <li>
          some tracks have no preview clip anywhere and will be skipped, so a playlist may
          play fewer songs than it holds;
        </li>
        <li>
          Spotify&rsquo;s editorial playlists cannot be read at all, and private or
          region-restricted playlists will fail;
        </li>
        <li>
          the upstream services this site depends on impose their own rate limits, and
          when they refuse a request, the game will too;
        </li>
        <li>
          we may change, suspend or discontinue any part of the service at any time,
          without notice.
        </li>
      </ul>
      <p>
        We do not warrant that the service will be uninterrupted, timely, secure or
        error-free.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, GuessSong and its maintainers are not
        liable for any indirect, incidental, special, consequential or punitive damages,
        or any loss of data, profits or goodwill, arising from your use of or inability to
        use the service. Since the service is provided free of charge, our total aggregate
        liability to you is limited to the amount you have paid for it, which is nothing.
      </p>
      <p>
        Nothing in these terms excludes or limits liability that cannot lawfully be
        excluded or limited, including liability for death or personal injury caused by
        negligence, or for fraud.
      </p>

      <h2>7. The code, and its licence</h2>
      <p>
        GuessSong&rsquo;s source code is published under the MIT licence at{" "}
        <a href="https://github.com/Waynting/GuessSong" target="_blank" rel="noopener noreferrer">
          github.com/Waynting/GuessSong
        </a>
        . That licence governs the code. It does not grant any right in the GuessSong
        name, in the music the game plays, or in any third-party service the code talks
        to — and these terms, not the licence, govern your use of the hosted site.
      </p>

      <h2>8. Privacy and advertising</h2>
      <p>
        The <Link href="/privacy">Privacy Policy</Link> forms part of these terms and
        describes what the site stores and which third parties are involved. This site
        carries advertising served by Google AdSense.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update these terms. The date at the top of this page records when they last
        changed, and continuing to use the site after a change means you accept the
        updated terms.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms, or a rights complaint about anything on this site:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We respond to
        well-founded takedown requests promptly — see the{" "}
        <Link href="/contact">contact page</Link> for what to include.
      </p>

      <div className="article-cta">
        <p>That&rsquo;s the paperwork. The game is more fun.</p>
        <Link href="/" className="cta-primary">
          Start a game →
        </Link>
      </div>
    </ArticleShell>
  );
}
