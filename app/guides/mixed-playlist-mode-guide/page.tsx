import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "mixed-playlist-mode-guide";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        A standard music quiz asks one question: what is this song. It is a good question,
        but it has a ceiling — the person who knows the most music wins, and after two
        rounds everyone in the room knows who that is.
      </p>
      <p>
        Mixed Playlist Mode asks a different question. Everyone submits their own playlist,
        the lists get merged into one pool, and the round becomes: <strong>whose playlist
        did this come from?</strong> That question has no expert. Your friend who can name
        any b-side from 1997 has no idea that the person across the table has been quietly
        listening to Enya for a decade.
      </p>

      <h2>Why the question is better</h2>
      <ul>
        <li>
          <strong>Nobody can study for it.</strong> The answer is not in the music, it is in
          the people, and everyone in the room has roughly equal access to that.
        </li>
        <li>
          <strong>Every song is somebody&rsquo;s.</strong> In a normal quiz, a track nobody
          knows is dead air. Here it is the most interesting round of the night, because
          someone has to own it.
        </li>
        <li>
          <strong>It produces the reveal.</strong> The moment where a name appears next to a
          song and the room turns to look at that person is the thing people talk about
          afterwards. A title reveal has never once done that.
        </li>
        <li>
          <strong>It scales down.</strong> Four people is enough. A conventional quiz needs
          six or more to feel like an event.
        </li>
      </ul>

      <h2>Two ways to collect the playlists</h2>

      <h3>Pass this phone</h3>
      <p>
        The host&rsquo;s device goes round the room. Each person types their name and pastes
        their playlist link, then hands it on. A masked confirmation shows that a playlist
        was added without revealing what is in it, so the next person cannot peek.
      </p>
      <p>
        Best for: a table of four to six, everyone in one place, no faffing with codes. It
        needs nothing beyond the one device already running the game.
      </p>

      <h3>QR code room</h3>
      <p>
        The host creates a room and gets a short code and a QR code. Everyone scans it on
        their own phone, submits their own playlist, and appears on the host&rsquo;s screen
        as they arrive. Nobody installs anything — it is a web page.
      </p>
      <p>
        Best for: more than six people, groups spread around a room, and anyone who does not
        want to hand their unlocked phone to seven people. It is also much faster: everyone
        submits at once rather than in sequence.
      </p>
      <div className="callout">
        <p className="callout-title">Rooms expire on purpose</p>
        <p>
          A room lives for a few hours and is designed to be consumed once, when the host
          starts the game. That is deliberate — nothing about the evening should outlive the
          evening. If you are setting up well in advance, create the room when people
          actually arrive, not the night before.
        </p>
      </div>

      <h2>What happens to the songs</h2>
      <p>Once the playlists are in, three things happen before the first clip plays:</p>
      <ol>
        <li>
          <strong>Sampling.</strong> Each playlist contributes a share of the pool, so the
          person who submitted 800 tracks does not drown out the person who submitted 40.
          Bringing a bigger playlist is not an advantage.
        </li>
        <li>
          <strong>Deduplication.</strong> Tracks that appear on more than one playlist are
          collapsed. This matters for fairness — a song three people picked would otherwise
          make &ldquo;whose is it&rdquo; unanswerable — and the overlaps are kept, because
          they turn out to be the interesting part at the end.
        </li>
        <li>
          <strong>Shuffling.</strong> The pool is randomised, so contributions do not arrive
          in blocks. If four songs in a row are obviously the same person&rsquo;s, the guess
          stops being a guess.
        </li>
      </ol>

      <h2>Scoring it</h2>
      <p>
        The usual 3 for the title and 1 for the album still apply, with{" "}
        <strong>2 points for correctly naming whose playlist the track came from</strong>.
      </p>
      <p>
        Two is the right weight. Lower and nobody bothers; higher and the actual music
        becomes a sideshow. It also has a useful property as a comeback mechanic: it is
        available on every single round, including the ones where nobody has any idea what
        the song is, so a player who is behind on titles always has a way back in.{" "}
        <Link href="/guides/music-quiz-scoring-rules">More scoring variants here.</Link>
      </p>

      <h2>Getting a good pool</h2>
      <ul>
        <li>
          <strong>Ask for an honest playlist, not a curated one.</strong> The instruction
          that works is &ldquo;send the one you actually listen to&rdquo;. People who build a
          playlist for the game submit what they want to be seen listening to, and that is
          both harder to guess and far less funny.
        </li>
        <li>
          <strong>Fifty to a hundred tracks each is plenty.</strong> Sampling means a huge
          playlist buys nothing.
        </li>
        <li>
          <strong>Public playlists only, and not Spotify&rsquo;s own.</strong> Editorial
          playlists cannot be read by third-party apps.{" "}
          <Link href="/guides/spotify-playlist-not-working">Why, and what to do instead.</Link>
        </li>
        <li>
          <strong>Nicknames are fine.</strong> Whatever someone types is what the room sees.
        </li>
      </ul>

      <h2>Reading the Taste Card</h2>
      <p>
        At the end you can save a shareable card summarising what the merged pool revealed.
        It carries three things worth understanding:
      </p>
      <ul>
        <li>
          <strong>Shared Bangers</strong> — the tracks that appeared on more than one
          playlist. This is the room&rsquo;s common ground, computed rather than guessed,
          and it is usually the part people screenshot.
        </li>
        <li>
          <strong>Most Obscure Taste</strong> — whose contributions the room found hardest
          to place. Worth reading as a compliment, whatever the recipient says.
        </li>
        <li>
          <strong>Most Mainstream</strong> — the highest average popularity score across
          submitted tracks. Also a compliment, and treated as one by nobody.
        </li>
      </ul>
      <p>
        You can also copy the whole merged tracklist at the end, with each song credited to
        whoever brought it. It is a genuinely good playlist — it is the intersection of a
        room of people who like each other — and it is the main reason groups run this mode
        twice.
      </p>

      <h2>When not to use it</h2>
      <p>
        It needs a group who know each other at least a bit. &ldquo;Whose song is
        this&rdquo; is not a question you can ask on the first evening of a work offsite
        where nobody has met. For those, run a{" "}
        <Link href="/guides/best-playlists-for-a-guess-the-song-game">shared-era playlist</Link>{" "}
        first and save this for the second round, once people have names for each other.
      </p>
    </GuideShell>
  );
}
