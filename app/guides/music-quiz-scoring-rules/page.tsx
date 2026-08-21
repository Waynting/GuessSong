import type { Metadata } from "next";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "music-quiz-scoring-rules";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        Scoring looks like bookkeeping. It is not. The scoring system is the thing that
        decides whether people are still playing in the last third of the night, and almost
        every music quiz that dies, dies because someone pulled ten points clear at song
        twelve and five people quietly stopped trying.
      </p>
      <p>
        Here is what the numbers are doing, and five variants that fix the specific problem
        you have.
      </p>

      <h2>Why three points for the title and one for the album</h2>
      <p>
        The default in GuessSong is <strong>3 points for naming the song, 1 more for naming
        the album it came from</strong>, awarded at most once each per round. That ratio is
        doing three jobs.
      </p>
      <ul>
        <li>
          <strong>The primary answer stays primary.</strong> At 3:1, the bonus is worth
          chasing but can never substitute for the main skill. A 1:1 split would turn the
          game into an album-trivia contest with music attached.
        </li>
        <li>
          <strong>It gives the room a second question.</strong> The moment after someone
          shouts the title is normally dead. A live bonus keeps six other people leaning in
          for another few seconds, and it is a different kind of knowledge, so it is usually
          a different person who gets it.
        </li>
        <li>
          <strong>It creates a comeback increment that is not a full round.</strong> Someone
          four points down can close the gap over three or four songs by picking up bonuses.
          That is enough to keep them in it without ever handing them a shortcut.
        </li>
      </ul>
      <p>
        The one-award-per-type rule matters as much as the numbers. Without it, a host who
        is being generous accidentally inflates a single round to eight or nine points and
        that round decides the night.
      </p>

      <h2>The runaway leader problem</h2>
      <p>
        This is the failure mode. It has a recognisable signature: the room gets quieter,
        two people are still shouting, and the rest have moved to talking to each other.
      </p>
      <p>
        The important insight is that <strong>the problem is not that someone is winning.
        It is that the others have correctly calculated they cannot.</strong> Nobody minds
        losing a close game. What kills a quiz night is a game that has been mathematically
        over for twenty minutes and is still being played.
      </p>
      <p>
        So the fix is not to slow the leader down. It is to keep the arithmetic open.
      </p>

      <h2>Five variants that keep it close</h2>

      <h3>1. The comeback round</h3>
      <p>
        For a block of five songs near the end, <strong>everyone below the current leader
        scores double</strong>. Announce it out loud, before the block starts.
      </p>
      <p>
        This is the best of the five, because it is public, mechanical and impersonal. It is
        not a favour to anyone and it does not single out the leader — it just re-opens the
        scoreboard at exactly the point in the evening when it has usually closed. A leader
        eight points clear is no longer safe, so they keep playing hard too.
      </p>

      <h3>2. The steal</h3>
      <p>
        If nobody names the song before the clip ends, the host plays it once more and{" "}
        <strong>only the player in last place may answer</strong>, for double points.
      </p>
      <p>
        Turns dead rounds — the ones where the clip ends in silence — into the most
        interesting moments of the night. It costs nothing, because those rounds were
        already wasted.
      </p>

      <h3>3. Wagers, before the clip</h3>
      <p>
        Once every five songs, players privately commit to a wager of 1, 2 or 3 points
        before hearing anything. Get it right, gain the wager; get it wrong, lose it.
      </p>
      <p>
        Adds a decision that is not about music knowledge at all, which is precisely why it
        redistributes points. Keep it occasional — every round would turn the game into
        arithmetic.
      </p>

      <h3>4. Teams, drawn after the first block</h3>
      <p>
        Play ten songs as individuals, then split into pairs, strongest with weakest, and
        play the rest as teams. Two effects: the strongest players are no longer competing
        with each other, and the least confident player now has someone confirming their
        guesses out loud, which is usually all they needed.
      </p>
      <p>
        This is the fix for a group where one or two people are genuinely far ahead of the
        rest.
      </p>

      <h3>5. Change what is being scored</h3>
      <p>
        The most complete fix is to stop asking the question the expert is good at. In a
        round built from everyone&rsquo;s own playlists, the scoring question becomes{" "}
        <strong>whose playlist did this come from</strong> — and knowing every song ever
        recorded does not help you guess that your quiet colleague listens to power ballads.
        See <a href="/guides/mixed-playlist-mode-guide">Mixed Playlist Mode</a>, where that
        guess is worth 2 points on top of the usual 3 and 1.
      </p>

      <h2>Rules worth settling before the first song</h2>
      <ul>
        <li>
          <strong>Wrong answers cost nothing.</strong> Penalties make people stop guessing,
          and a room that has stopped guessing is a room that has stopped playing. The
          exception is a declared wager, which the player chose.
        </li>
        <li>
          <strong>Artist alone is not the song.</strong> Otherwise half the room shouts the
          band name on every clip. If you want to reward it, make it worth 1 point, like the
          album.
        </li>
        <li>
          <strong>Close enough is close enough.</strong> A missing &ldquo;the&rdquo;, an
          accent, an approximate translation of a title — all fine. Adjudicating exact
          wording is the fastest way to make a party feel like a test.
        </li>
        <li>
          <strong>The host&rsquo;s call is final, and the host says so at the start.</strong>{" "}
          One sentence up front prevents every argument later. Simultaneous shouts go to
          whoever the host heard first; that is a judgement, not a measurement, and everyone
          should know that going in.
        </li>
      </ul>

      <h2>How often to read the scores out</h2>
      <p>
        Every three or four songs. Not every song — that turns the game into admin and makes
        the gap the most salient thing in the room. Not never, either: people need to know
        whether the last five minutes changed anything.
      </p>
      <p>
        One refinement worth the effort: when you read them, read <em>up</em> from the
        bottom, and read the gaps rather than the totals. &ldquo;Three points between fourth
        and first&rdquo; is a live game. &ldquo;Sam has 22&rdquo; is a result.
      </p>

      <h2>Ending it</h2>
      <p>
        Say the number of songs at the start, and stop there even if the game is close —
        especially if it is close. A quiz that ends while people still want another round is
        a quiz that gets played again. Sudden-death tie-breaks are the one good reason to
        add songs: same rules, five-second clips, first correct answer takes it.
      </p>
    </GuideShell>
  );
}
