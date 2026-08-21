import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "spotify-playlist-not-working";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        A playlist that will not load is the most common thing that goes wrong in a
        Spotify-based game, and it almost always happens at the worst possible moment —
        eight people sitting down, host pasting a link, nothing happening.
      </p>
      <p>
        The good news is that the causes are few and distinguishable. In our experience four
        of them account for nearly everything, and three can be fixed in under a minute.
        Work down this list in order.
      </p>

      <h2>1. It is one of Spotify&rsquo;s own playlists</h2>
      <p>
        This is the single biggest cause, and it surprises everyone, because these playlists
        are the most visible ones in the app.
      </p>
      <p>
        Playlists curated by Spotify itself — Today&rsquo;s Top Hits, Discover Weekly,
        RapCaviar, All Out 2000s, every &ldquo;This Is&rdquo; playlist, most mood and genre
        mixes on the browse page — <strong>cannot be read by third-party applications at
        all</strong>. In late 2024 Spotify restricted access to its editorial catalogue for
        newly registered applications, and requests for those playlists now come back as
        &ldquo;not found&rdquo;, even though the playlist very obviously exists and you are
        looking at it.
      </p>
      <div className="callout">
        <p className="callout-title">How to spot one in two seconds</p>
        <p>
          Look at the playlist id in the link. If it begins <code>37i9</code>, it is a
          Spotify editorial playlist and no third-party app can load it:
          <br />
          <code>open.spotify.com/playlist/<strong>37i9</strong>dQZF1DXcBWIGoYBM5M</code>
        </p>
      </div>
      <p>
        <strong>The fix, and it takes about thirty seconds:</strong> open the playlist in
        Spotify, select all the tracks, add them to a new playlist of your own, make that
        playlist public, and use its link instead. A copy owned by a normal user account
        reads perfectly. The tracks are identical.
      </p>
      <p>
        This is also a good excuse to trim it. A copied chart playlist is usually better for
        a quiz after you delete the ten songs nobody in your room will know —{" "}
        <Link href="/guides/best-playlists-for-a-guess-the-song-game">more on that here</Link>.
      </p>

      <h2>2. The playlist is private, or collaborative-only</h2>
      <p>
        A playlist has to be public for an app that is not logged in as you to see it. This
        catches people out because a private playlist still produces a perfectly normal
        share link — the link works for you, because you are signed in as its owner, and
        fails for everyone and everything else.
      </p>
      <p>
        <strong>The fix:</strong> in Spotify, open the playlist, use the three-dot menu, and
        choose the option to make it public. On mobile the wording differs slightly by
        version but it is always in that menu. Then re-copy the link — and give it a few
        seconds, since the change is not always instantaneous.
      </p>
      <p>
        Note that &ldquo;collaborative&rdquo; is not the same as &ldquo;public&rdquo;. A
        collaborative playlist that is not also public still cannot be read.
      </p>

      <h2>3. It is the wrong kind of link</h2>
      <p>
        Spotify has several share surfaces and they do not all produce a playlist URL. The
        ones that fail:
      </p>
      <ul>
        <li>
          <strong>An album link.</strong> <code>/album/…</code> is not <code>/playlist/…</code>.
          Easy to do from the Now Playing screen.
        </li>
        <li>
          <strong>An artist or track link.</strong> Same problem — check the path segment.
        </li>
        <li>
          <strong>A short <code>spotify.link</code> URL.</strong> Some share sheets produce
          a redirect link rather than the real one. Open it in a browser first and copy the
          address it lands on.
        </li>
        <li>
          <strong>A Spotify URI.</strong> <code>spotify:playlist:…</code> is the desktop
          app&rsquo;s internal format, not a web address.
        </li>
        <li>
          <strong>A folder.</strong> Folders group playlists in the desktop app and are not
          playlists themselves. There is nothing to share.
        </li>
      </ul>
      <p>
        <strong>What a working link looks like:</strong>
        <br />
        <code>https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n</code>
      </p>
      <p>
        Anything after a <code>?</code> is tracking parameters and can be left on or
        removed; it makes no difference.
      </p>

      <h2>4. Rate limiting — and how to tell it apart</h2>
      <p>
        This one is different in kind from the first three, and confusing it with them wastes
        the most time.
      </p>
      <p>
        Spotify limits how often an application may call its API, and the limit applies to{" "}
        <strong>the application as a whole, not to you</strong>. So if a lot of people are
        starting games at the same moment, a playlist that is perfectly fine can be refused
        for a while. Your link is not the problem, and re-pasting it will not help.
      </p>
      <p>
        A well-built app will tell you the difference explicitly rather than showing a
        generic error — being told to check that your playlist is public when the playlist
        was always public is how a host ends up spending ten minutes changing settings that
        were never wrong. If you see a message about the service being busy or a wait time,
        that is this.
      </p>
      <p>
        <strong>The fix:</strong> wait a minute or two and try again. Nothing on your side
        needs changing. Playlists that have already been loaded recently usually keep
        working throughout, so if you have a backup playlist you used earlier, it will
        probably still start.
      </p>

      <h2>Rarer causes worth knowing</h2>
      <ul>
        <li>
          <strong>The playlist is empty, or has fewer tracks than the game needs.</strong>{" "}
          Local files in a playlist do not count — they are not on Spotify&rsquo;s servers
          and are invisible to any API.
        </li>
        <li>
          <strong>Region restrictions.</strong> A playlist built entirely of tracks
          unavailable in the market the app queries can come back looking empty.
        </li>
        <li>
          <strong>Very large playlists get sampled.</strong> Playlists in the thousands are
          usually read only up to a cap — a few hundred tracks, drawn from across the list.
          For a game that plays 30 songs this changes nothing, but it is why a 4,000-track
          playlist does not take a minute to load.
        </li>
        <li>
          <strong>The playlist was deleted, or the owner made it private after sharing.</strong>{" "}
          The link survives; the playlist does not.
        </li>
      </ul>

      <h2>A different problem: it loaded, but songs have no audio</h2>
      <p>
        If the playlist loaded fine and the game runs but some tracks are silent or skipped,
        nothing above applies. That is the preview-clip problem, and it has an unrelated
        cause: Spotify stopped supplying 30-second preview URLs to new applications, so
        games now find clips elsewhere and coverage is not total.
      </p>
      <p>
        <Link href="/guides/why-spotify-previews-disappeared">
          What actually happened, and what we measured
        </Link>{" "}
        is the full story. The short version: pick mainstream tracks and the hit rate is very
        high.
      </p>

      <h2>Quick reference</h2>
      <table>
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Most likely cause</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Not found, but the playlist clearly exists</td>
            <td>Editorial playlist (<code>37i9…</code>)</td>
            <td>Copy the tracks to your own public playlist</td>
          </tr>
          <tr>
            <td>Not found, and it is your own playlist</td>
            <td>Private</td>
            <td>Make it public, re-copy the link</td>
          </tr>
          <tr>
            <td>Rejected immediately as invalid</td>
            <td>Album, track, folder or short link</td>
            <td>Use a <code>/playlist/</code> URL</td>
          </tr>
          <tr>
            <td>Worked earlier, fails now</td>
            <td>Rate limiting</td>
            <td>Wait a minute; change nothing</td>
          </tr>
          <tr>
            <td>Loads, but tracks are silent</td>
            <td>No preview clip available</td>
            <td>Prefer mainstream tracks</td>
          </tr>
        </tbody>
      </table>
    </GuideShell>
  );
}
