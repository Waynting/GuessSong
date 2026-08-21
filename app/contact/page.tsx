import type { Metadata } from "next";
import Link from "next/link";
import { ArticleShell } from "@/components/article-shell";
import { CONTACT_EMAIL, REPORT_PROBLEM_MAILTO } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "How to reach the person who maintains GuessSong — bug reports, playlists that will not load, rights complaints, privacy requests and press.",
  alternates: { canonical: "/contact" },
};

const GITHUB_URL = "https://github.com/Waynting/GuessSong";

export default function ContactPage() {
  return (
    <ArticleShell
      eyebrow="Contact"
      title="Get in touch"
      lede="GuessSong is maintained by one person. Mail reaches them directly — there is no ticket queue and no bot in between."
      meta={`Email ${CONTACT_EMAIL} · Usually answered within a few days`}
      backHref="/"
    >
      <div className="callout">
        <p className="callout-title">Email</p>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> — the address for
          everything below. Please write in English or Chinese.
        </p>
      </div>

      <h2>A playlist will not load</h2>
      <p>
        Check the <Link href="/guides/spotify-playlist-not-working">troubleshooting guide</Link>{" "}
        first — it covers the four causes behind almost every report, and three of them you
        can fix in ten seconds. If none of those is it, send us the playlist link and the
        exact message the site showed you.
      </p>

      <h2>A song played the wrong audio</h2>
      <p>
        The game finds clips on iTunes and Deezer by title and artist, and once in a while
        a cover version or a same-titled song wins. Tell us the song and the playlist and
        we will look at why the match went wrong. Include what you actually heard — that
        is the part that identifies the bad match.
      </p>

      <h2>Bugs and feature requests</h2>
      <p>
        Use{" "}
        <a href={REPORT_PROBLEM_MAILTO}>the problem report link</a>, or open an issue on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Issues are public and get looked at faster, because the discussion stays with the
        code. Helpful things to include: what device and browser, how many players, whether
        it was a single playlist or Mixed Playlist Mode, and what you expected instead.
      </p>

      <h2>Privacy requests</h2>
      <p>
        Access, correction, deletion or objection requests go to the same address. Worth
        knowing before you write: there are no accounts here, so in almost every case there
        is nothing on file about you to return or delete. The{" "}
        <Link href="/privacy">Privacy Policy</Link> sets out the few exceptions and how
        long each one lives.
      </p>

      <h2>Rights holders and takedown requests</h2>
      <p>
        GuessSong does not host, store or distribute any audio. It links to preview clips
        published by iTunes and Deezer and plays them in the browser, and it reads public
        playlist metadata from Spotify. If you believe something on this site infringes
        your rights, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with:
      </p>
      <ul>
        <li>identification of the work concerned;</li>
        <li>the exact URL on this site where it appears;</li>
        <li>your contact details and the basis of your claim;</li>
        <li>a statement that you are the rights holder or authorised to act for them.</li>
      </ul>
      <p>We act on well-founded requests promptly.</p>

      <h2>Press, and using GuessSong somewhere</h2>
      <p>
        Happy to answer questions from writers, and happy for teachers, event hosts and
        team leads to use the game — no permission needed, no licence to ask for. If you
        are running it at something larger than a living room, read section 3 of the{" "}
        <Link href="/terms">Terms</Link> on public performance first; that part is on you,
        not on us.
      </p>

      <h2>Contributing</h2>
      <p>
        The whole project is MIT-licensed and open at{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          github.com/Waynting/GuessSong
        </a>
        . Pull requests are welcome, and so is a star if the game earned one.
      </p>

      <div className="article-cta">
        <p>Or skip the email and just play a round.</p>
        <Link href="/" className="cta-primary">
          Start a game →
        </Link>
      </div>
    </ArticleShell>
  );
}
