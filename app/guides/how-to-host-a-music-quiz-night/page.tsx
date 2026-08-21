import type { Metadata } from "next";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "how-to-host-a-music-quiz-night";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        The music is the easy part. Pick any decent playlist and the songs will be fine.
        What decides whether a quiz night works is a set of much duller decisions — how
        long a round runs, who controls the pause button, what happens when one person
        turns out to know everything — and those get made badly by default, because most
        hosts are thinking about the songs.
      </p>
      <p>
        This is what we have learned watching these run, and what to do differently.
      </p>

      <h2>Decide the length before anyone arrives</h2>
      <p>
        A music quiz is not an evening&rsquo;s entertainment. It is a <strong>forty-minute
        opener</strong> that people remember fondly, or a ninety-minute slog they remember
        as the bit before the good part of the night. The difference is almost entirely
        length.
      </p>
      <p>
        A workable shape for a group of six to ten:
      </p>
      <ul>
        <li>
          <strong>20 songs</strong> for a first time with this group. About 25 minutes with
          the talking.
        </li>
        <li>
          <strong>30 songs</strong> if they have played before and asked for it again.
        </li>
        <li>
          <strong>50 songs</strong> only if you are running actual rounds with breaks
          between them, and someone else is handling drinks.
        </li>
      </ul>
      <p>
        Err short. A room that wanted three more songs will play again next month. A room
        that got eight more than it wanted will not.
      </p>

      <h2>One screen, one host, and the host does not play</h2>
      <p>
        The strongest structural choice you can make is to have the host judge rather than
        compete. It removes every argument about who said it first, it means somebody is
        always watching the room rather than the scoreboard, and it lets you do the thing
        that actually makes a quiz good: adjusting difficulty live.
      </p>
      <p>
        Hosts resist this because it sounds like not getting to play. In practice the host
        has the best seat. You see the exact moment recognition crosses someone&rsquo;s
        face, three seconds before they can name what they are hearing, and you get to
        decide whether to let it run.
      </p>
      <div className="callout">
        <p className="callout-title">If the host wants to play</p>
        <p>
          Rotate. Host the first ten songs, hand the device to whoever is last on the
          scoreboard, and let them host the next ten. It fixes two problems at once: the
          host gets a turn, and the person doing worst gets a break from doing worst.
        </p>
      </div>

      <h2>Verbal answers beat written ones at this size</h2>
      <p>
        Pub quizzes use answer sheets because forty people cannot shout at one host. Eight
        people can. Below about a dozen players, shouted answers are strictly better:
      </p>
      <ul>
        <li>
          <strong>No dead time.</strong> Written rounds have a scoring gap after every ten
          songs where nothing happens and the room checks their phones.
        </li>
        <li>
          <strong>The near-misses are the fun.</strong> Someone yelling a wrong band name
          with total confidence is most of what people remember. A sheet swallows that.
        </li>
        <li>
          <strong>No spelling arguments.</strong> Nobody has to adjudicate whether
          &ldquo;Chilli Peppers&rdquo; counts.
        </li>
      </ul>
      <p>
        The cost is that fast talkers dominate. That is a real cost, and the scoring
        section below is where you fix it.
      </p>

      <h2>The person who knows everything</h2>
      <p>
        Every group has one. By song six the rest of the room has worked out they cannot
        win and stops trying, which is the actual failure — not that someone is winning,
        but that six other people have quietly stopped playing.
      </p>
      <p>Three fixes, in order of how little they feel like punishment:</p>
      <ol>
        <li>
          <strong>Give them a job.</strong> Ask them to co-host the second half. Expertise
          is more fun to display as commentary than as a score.
        </li>
        <li>
          <strong>Change the question.</strong> Switch to a round where everyone submits
          their own playlist and the question becomes &ldquo;whose song is this&rdquo;.
          Encyclopaedic music knowledge does not help you guess that your colleague
          secretly loves Enya.
        </li>
        <li>
          <strong>Handicap the format, not the person.</strong> A comeback round where
          points are doubled for everyone below the leader is fair, public and does not
          single anyone out. More of these in{" "}
          <a href="/guides/music-quiz-scoring-rules">the scoring guide</a>.
        </li>
      </ol>
      <p>
        What does not work is a private handicap. People notice, and it reads as pity.
      </p>

      <h2>Sound: the failure nobody plans for</h2>
      <p>
        Preview clips are mastered at wildly different volumes, and a laptop speaker in a
        room of ten talking people is not enough. Two minutes of setup solves an evening
        of &ldquo;can you turn it up&rdquo;:
      </p>
      <ul>
        <li>
          Use a real speaker. Any Bluetooth speaker beats any laptop. Pair it{" "}
          <em>before</em> people arrive — pairing in front of an audience is the single
          most common way a quiz night starts badly.
        </li>
        <li>
          Set the volume on the loudest song you can find, not the first one. Then leave it
          alone.
        </li>
        <li>
          If you are on Bluetooth, expect a fraction of a second of delay when a clip
          starts. Count it into your timing rather than fighting it.
        </li>
        <li>
          Sit people so nobody is behind the speaker. Sounds obvious; is routinely wrong.
        </li>
      </ul>

      <h2>Seat the room so everyone can see the host</h2>
      <p>
        The host&rsquo;s face is the interface. People need to see whether their answer
        registered, and they need to see the moment the answer is revealed. A rough
        semicircle facing the host, with the speaker behind or beside them, works. A long
        table where four people are looking at the back of someone&rsquo;s head does not.
      </p>

      <h2>Five mistakes that flatten a good night</h2>
      <ol>
        <li>
          <strong>Explaining the rules for four minutes.</strong> Explain the first round
          only, in two sentences, and start. Rules learned by playing stick; rules
          explained up front do not.
        </li>
        <li>
          <strong>Letting a song run too long.</strong> If nobody has it in fifteen
          seconds, nobody has it. Reveal, react, move on. The reveal is fast entertainment;
          silence is not.
        </li>
        <li>
          <strong>Announcing the scores after every song.</strong> Every three or four is
          plenty. Constant scoreboard updates make it feel like admin.
        </li>
        <li>
          <strong>Picking a playlist only you know.</strong> Your taste is not a difficulty
          setting, it is an exclusion. See{" "}
          <a href="/guides/best-playlists-for-a-guess-the-song-game">picking a playlist</a>.
        </li>
        <li>
          <strong>Not knowing how it ends.</strong> Say the number of songs out loud at the
          start. A game with a visible finish line has a last round people push for; one
          without just stops when someone gets bored.
        </li>
      </ol>

      <h2>A running order that works</h2>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Songs</th>
            <th>Clip length</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Warm-up</td>
            <td>5</td>
            <td>15–30s</td>
            <td>Everyone scores something. Nobody is losing yet.</td>
          </tr>
          <tr>
            <td>Main</td>
            <td>10–15</td>
            <td>10s</td>
            <td>The real game. Fast, competitive.</td>
          </tr>
          <tr>
            <td>Comeback</td>
            <td>5</td>
            <td>10s</td>
            <td>Double points below the leader. Re-opens the night.</td>
          </tr>
          <tr>
            <td>Finish</td>
            <td>3–5</td>
            <td>5s</td>
            <td>Short and brutal. Ends on a spike, not a fade.</td>
          </tr>
        </tbody>
      </table>
      <p>
        The shape matters more than the numbers: start generous, tighten in the middle,
        re-open the scores, end fast. A night that gets harder as it goes feels like it is
        building. A night at one difficulty feels like a list.
      </p>

      <h2>Have a plan for a song with no audio</h2>
      <p>
        Some tracks have no preview clip available anywhere — a real constraint of how
        music previews work, explained in{" "}
        <a href="/guides/why-spotify-previews-disappeared">this piece on what happened to Spotify&rsquo;s previews</a>.
        Do not stop and debug it in front of the room. Skip it, say &ldquo;that one&rsquo;s
        broken, next&rdquo;, and keep the tempo. The room will not care unless you make
        them care.
      </p>
    </GuideShell>
  );
}
