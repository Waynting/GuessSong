import type { Metadata } from "next";
import Link from "next/link";
import { ArticleShell } from "@/components/article-shell";
import { CONTACT_EMAIL } from "@/lib/contact";
import { POLICY_LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What GuessSong stores, what it does not, and which third parties are involved. GuessSong has no accounts and no login: game state lives in your own browser.",
  alternates: {
    canonical: "/privacy",
    languages: { en: "/privacy", "zh-TW": "/zh/privacy", "x-default": "/privacy" },
  },
};

export default function PrivacyPage() {
  return (
    <ArticleShell
      eyebrow="Legal"
      title="Privacy Policy"
      lede="GuessSong has no accounts, no login and no user profiles. This page describes exactly what does get stored, for how long, and who else is involved."
      meta={`Last updated ${POLICY_LAST_UPDATED} · Operated by GuessSong · ${CONTACT_EMAIL}`}
      backHref="/"
    >
      <div className="callout">
        <p className="callout-title">The short version</p>
        <p>
          We never ask who you are. Your game — playlist, player names, scores — is held
          by your own browser and disappears when you close the tab. The only things that
          reach a server are a playlist link (to read its track list), a song title and
          artist (to find an audio clip), and, if you use Mixed Playlist Mode, a room that
          deletes itself within hours. Google AdSense and Google Analytics run on this
          site and set their own cookies.
        </p>
      </div>

      <h2>Who we are</h2>
      <p>
        GuessSong (&ldquo;we&rdquo;, &ldquo;the site&rdquo;) is a free, open-source party
        game published at <code>www.guessong.app</code>. The source code is public at{" "}
        <a href="https://github.com/Waynting/GuessSong" target="_blank" rel="noopener noreferrer">
          github.com/Waynting/GuessSong
        </a>
        , so every claim on this page can be checked against the code that makes it. For
        any privacy question, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>We do not have accounts</h2>
      <p>
        There is no sign-up, no login, no password and no Spotify authorisation step.
        We do not know your name, email address or Spotify identity, because the site
        never asks for them and has nowhere to put them. There is no user database.
      </p>

      <h2>What stays in your browser</h2>
      <p>
        A game in progress is held in your device&rsquo;s <strong>session storage</strong>
        — a per-tab store the browser clears when you close the tab. It contains the
        tracks drawn from the playlist you pasted, the player names you typed, the clip
        length you chose and the running scores. It is never transmitted to us.
      </p>
      <p>
        The site also uses <strong>local storage</strong> for small preferences, such as
        whether you have already seen the current release notes. Clearing your browser
        data for this site removes both.
      </p>

      <h2>What reaches our servers</h2>
      <h3>Playlist lookups</h3>
      <p>
        When you paste a Spotify playlist link, that link is sent to our server, which
        asks Spotify&rsquo;s public Web API for the playlist&rsquo;s name and track list.
        We use Spotify&rsquo;s <em>Client Credentials</em> flow, which authenticates{" "}
        <em>this application</em> and not you: Spotify is never told who is asking, and
        we never gain access to your Spotify account, library or listening history. The
        resulting track list is cached on our side for a few hours, keyed by the playlist
        id, so that a popular playlist is not fetched repeatedly.
      </p>

      <h3>Audio clip lookups</h3>
      <p>
        Spotify stopped supplying preview clips for most tracks in late 2024, so for each
        song the site sends the <strong>song title and artist name</strong> to the iTunes
        Search API and, if that finds nothing, to Deezer, in order to locate a 30-second
        preview. Only the title and artist are sent. The result is cached by track id,
        including &ldquo;no preview exists&rdquo; results.
      </p>

      <h3>Mixed Playlist Mode rooms</h3>
      <p>
        If you create a room so that other people can submit playlists from their phones,
        we store — in a temporary key-value store — the room code, the display names
        players type in, and the track lists drawn from the playlists they submit. This
        record carries an expiry from the moment it is created and is deleted
        automatically when that expiry passes; it is also intended to be consumed once,
        when the host starts the game. Type a nickname rather than your legal name if you
        would rather not appear in it.
      </p>

      <h3>Buzzer rooms</h3>
      <p>
        Buzzer Mode runs on Cloudflare Durable Objects and holds, for the life of the
        room only, the player names in it and who pressed first. Nothing survives the room.
      </p>

      <h3>Rate limiting and abuse prevention</h3>
      <p>
        To stop one visitor from exhausting the shared quotas we have with Spotify and
        iTunes, our server counts requests per <strong>IP address</strong> in a short
        fixed window. What is stored is a counter against a key derived from the address,
        held for the length of that window (minutes) and then gone. We do not build
        profiles from it and do not use it to identify anyone.
      </p>

      <h3>Server logs</h3>
      <p>
        Our hosting provider, Vercel, records standard request logs (timestamp, path,
        response status, IP address, user agent) as part of operating the service. These
        are retained by Vercel under their own policy and are used only for debugging and
        security.
      </p>

      <h2>Counting, not tracking</h2>
      <p>
        We keep a small set of aggregate counters — how many games were started, how many
        people arrived from a shared link — as plain numbers per day. They are totals with
        no identifier attached and cannot be traced back to a person or a device.
      </p>

      <h2>Third parties, cookies and advertising</h2>
      <p>
        Three Google services run on this site, and each sets its own cookies or similar
        identifiers under its own policy:
      </p>
      <ul>
        <li>
          <strong>Google AdSense</strong> serves the advertising on this site. Google and
          its partners may use cookies to serve ads based on your prior visits to this and
          other websites.
        </li>
        <li>
          <strong>Google Analytics 4</strong> gives us aggregate usage statistics — page
          views, which features are used, which errors occur. Failure reasons are recorded
          as fixed categories, never as raw text, so nothing you paste or type is
          forwarded to Analytics.
        </li>
        <li>
          <strong>Google Fonts</strong> serves the two typefaces the site uses.
        </li>
      </ul>
      <p>
        Google&rsquo;s use of advertising cookies enables it and its partners to serve ads
        to you based on your visit to this site and other sites on the internet. You can
        opt out of personalised advertising at{" "}
        <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
          Google Ads Settings
        </a>
        , or opt out of third-party vendors&rsquo; use of cookies for personalised
        advertising at{" "}
        <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">
          aboutads.info/choices
        </a>
        . Google&rsquo;s own handling of data is described in its{" "}
        <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
          privacy and terms
        </a>
        .
      </p>
      <p>
        We also depend on Spotify, Apple (iTunes Search), Deezer, Vercel, Upstash and
        Cloudflare as described above. We do not sell or share personal information, and
        there is no personal information here to sell.
      </p>

      <h2>Visitors in the EEA, UK and Switzerland</h2>
      <p>
        Where a lawful basis is required, we rely on <strong>legitimate interests</strong>
        for the technical processing that makes the game work (playlist and clip lookups,
        rate limiting, server logs), and on <strong>consent</strong> for advertising and
        analytics cookies, collected through Google&rsquo;s consent mechanism where it
        applies. You have the right to access, correct, delete, restrict or object to
        processing of your personal data, and to complain to your local supervisory
        authority. Because we hold no accounts, in most cases we have nothing on file to
        return — but write to us and we will tell you exactly that.
      </p>

      <h2>Visitors in California</h2>
      <p>
        We do not sell personal information and do not share it for cross-context
        behavioural advertising as those terms are defined by the CCPA/CPRA. To exercise
        any CCPA right, contact us at the address below.
      </p>

      <h2>Children</h2>
      <p>
        GuessSong is a general-audience game and is not directed at children under 13. We
        do not knowingly collect personal information from children. If you believe a
        child has submitted personal information through a Mixed Playlist room, tell us
        and we will remove it — and note that these rooms expire on their own within hours
        regardless.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes materially, the date at the top of the page changes with it.
        The site&rsquo;s release notes, linked in the footer, record when.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, requests and complaints:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. There is more on how to
        reach us on the <Link href="/contact">contact page</Link>.
      </p>

      <div className="article-cta">
        <p>Nothing to sign up for. Paste a playlist and play.</p>
        <Link href="/" className="cta-primary">
          Start a game →
        </Link>
      </div>
    </ArticleShell>
  );
}
