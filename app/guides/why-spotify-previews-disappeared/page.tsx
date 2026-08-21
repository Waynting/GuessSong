import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "why-spotify-previews-disappeared";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        For most of the last decade, if you wanted to play a short snippet of a song in a
        web app, the answer was easy. Spotify&rsquo;s API returned a field called{" "}
        <code>preview_url</code> on every track: a link to a 30-second MP3, no
        authentication needed to play it, free to use. An enormous number of small music
        tools were built on that one field.
      </p>
      <p>
        In late 2024 it stopped coming back. This is what we measured when we went looking,
        and what a music game has to do instead.
      </p>

      <h2>What changed</h2>
      <p>
        In November 2024 Spotify restricted a group of Web API capabilities for{" "}
        <strong>newly registered applications</strong>. The list included recommendations,
        audio-features data, related-artists lookups, access to Spotify&rsquo;s own editorial
        playlists — and 30-second preview URLs.
      </p>
      <p>
        The change was not retroactive for applications that already existed, which is the
        detail that made it so confusing to diagnose. Existing integrations carried on
        working. Documentation still described the field. Tutorials still used it. Answers on
        forums still recommended it. But any application registered after the cutoff got{" "}
        <code>null</code> where the URL used to be, with no error and no explanation — the
        field is still there in the response, it is simply empty.
      </p>
      <p>
        A silent null is about the worst way for a dependency to break. There is nothing to
        catch, nothing logged, no status code to check. The song list loads perfectly and
        then nothing plays.
      </p>

      <h2>What we measured</h2>
      <p>
        When we hit this, the first hypothesis was the obvious one: a licensing gap, some
        tracks in some regions. Preview availability had always been patchy, so partial
        coverage seemed plausible. We checked it properly before building around it.
      </p>
      <p>
        We pulled twenty well-known, mainstream tracks and requested them through the
        Client Credentials flow — the server-to-server mode an app uses when it is acting as
        itself rather than on behalf of a logged-in user — across four different market
        codes, on an application registered after the cutoff.
      </p>
      <div className="callout">
        <p className="callout-title">The result</p>
        <p>
          <strong>0 of 20 tracks returned a preview URL. In all four markets.</strong> Not a
          coverage gap. Not region-dependent. The field is simply never populated for this
          class of application.
        </p>
      </div>
      <p>
        That number settled the design question immediately. A partial result would have
        meant building a fallback for the gaps. A clean zero means the field cannot be a
        source at all — which is why the track type in this project carries no{" "}
        <code>previewUrl</code> field whatsoever. Leaving it in as an optional would have
        invited someone to reach for it later and rediscover the null the hard way.
      </p>

      <h2>Where clips come from now</h2>
      <p>
        The workaround the ecosystem converged on is to look the song up somewhere else
        entirely, by name.
      </p>
      <p>
        Two public catalogues still publish 30-second previews without authentication:{" "}
        <strong>the iTunes Search API</strong> and <strong>Deezer</strong>. Given a track&rsquo;s
        title and artist from Spotify, you search one, and if that fails, the other. It works.
        It is also considerably more fragile than reading a field, in three specific ways.
      </p>

      <h3>The volume is per-track, not per-playlist</h3>
      <p>
        Spotify is asked about a playlist once. iTunes and Deezer have to be asked about
        every single song. A cold 50-song game is 50 separate lookups, each of which may
        need several queries before something matches — the difference between one upstream
        request and a couple of hundred. Both services rate-limit, so any app doing this at
        scale needs aggressive caching just to stay under their ceilings.
      </p>

      <h3>Matching by name is genuinely hard</h3>
      <p>
        This is the interesting part. Searching a catalogue by title and artist sounds
        trivial and is full of traps:
      </p>
      <ul>
        <li>
          <strong>Common titles return the most popular song with that name.</strong> Ask
          iTunes for &ldquo;Hello&rdquo; without an artist and you can get a children&rsquo;s
          nursery-rhyme version. Ask for &ldquo;Alone&rdquo; and you get Heart. If a game
          accepted those, it would play one song and reveal a different one — a bug that
          looks, to the player, like the game simply being wrong.
        </li>
        <li>
          <strong>The same recording is credited differently in different catalogues.</strong>{" "}
          Non-Latin-script artists are the sharp edge here. A track Spotify lists under the
          artist 田馥甄 may be listed by iTunes as &ldquo;Hebe Tien&rdquo;, with the title
          translated too. A strict artist-name comparison rejects the correct result and
          finds nothing for an entire catalogue of music.
        </li>
        <li>
          <strong>Remasters, live versions, radio edits and karaoke covers</strong> all
          match the title closely and are all the wrong recording.
        </li>
      </ul>
      <p>
        The approach that holds up is to ask progressively looser questions, and to raise
        the standard of proof as the question gets looser. A query that includes the artist
        can trust the result, because the catalogue already used that signal. A query that
        drops the artist — the last resort, where the catalogue is ranking purely by
        popularity — has to verify the candidate some other way, by a matching credit or a
        matching running time, before accepting it.
      </p>

      <h3>&ldquo;No preview exists&rdquo; and &ldquo;we could not check&rdquo; are different answers</h3>
      <p>
        The subtlest problem, and the one most likely to be got wrong, is what to do with a
        failure.
      </p>
      <p>
        If a catalogue answers cleanly and has nothing, that is a durable fact about the
        recording: no clip exists, and it will not exist tomorrow either. Worth remembering
        for a long time.
      </p>
      <p>
        If the request was rate-limited, timed out, or never arrived, that is a fact about{" "}
        <em>the requester</em>, and it is true for about a minute. Treating the second like
        the first is how one busy moment marks a slice of the catalogue permanently silent —
        a bug that never reproduces in testing, because a developer&rsquo;s own machine is
        never the one being throttled.
      </p>
      <p>
        There are traps in reading the failures too. iTunes signals throttling with a{" "}
        <code>403</code> rather than the <code>429</code> you would expect, and Deezer can
        return a quota error inside the body of an otherwise successful{" "}
        <code>200</code> response. Reading only the status code classifies both as
        &ldquo;no result found&rdquo;.
      </p>

      <h2>What this means when you are playing</h2>
      <ul>
        <li>
          <strong>Some tracks have no clip anywhere and will be skipped.</strong> This is not
          a bug and there is no setting that fixes it.
        </li>
        <li>
          <strong>Mainstream music has near-total coverage.</strong> Well-known releases are
          in every catalogue. Obscure independents, regional releases and very new tracks are
          where the gaps are.{" "}
          <Link href="/guides/best-playlists-for-a-guess-the-song-game">
            Choosing a playlist with this in mind
          </Link>{" "}
          costs nothing and removes almost all of it.
        </li>
        <li>
          <strong>Clip URLs go stale.</strong> The files sit on content-delivery networks
          that rotate them, so a link that worked six months ago may not today. A clip that
          fails to start is usually this, and re-resolving it fixes it.
        </li>
        <li>
          <strong>Occasionally a clip is the wrong recording.</strong> A cover, a live
          version, or a different song with the same title. Given the matching problem above,
          this is the residual error rate rather than a mistake — if you hit one,{" "}
          <Link href="/contact">tell us which song</Link>, because each report is a concrete
          case to fix.
        </li>
      </ul>

      <h2>The wider point</h2>
      <p>
        A whole category of small music tools was built on one convenient field in one
        company&rsquo;s API, and that field went away with a documentation note and no
        error message. What replaced it is not one lookup but a search problem, a matching
        problem, a caching problem and a failure-classification problem.
      </p>
      <p>
        Everything above is visible in this project&rsquo;s source, which is public. If you
        are building something similar, that is probably a faster read than rediscovering
        the <code>403</code>.
      </p>
    </GuideShell>
  );
}
