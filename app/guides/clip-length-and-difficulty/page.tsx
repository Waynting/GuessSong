import type { Metadata } from "next";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "clip-length-and-difficulty";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        Most settings in a guessing game change the content: which songs, how many, who is
        playing. Clip length changes the <em>game</em>. The same playlist at five seconds
        and at thirty is two different evenings, and the gap between them is much wider
        than the numbers suggest.
      </p>

      <h2>What is actually happening in those seconds</h2>
      <p>
        Song recognition is not gradual. It is a threshold: you have no idea, you have no
        idea, and then you know — usually all at once, and usually a beat or two before you
        can produce the title. Research on this has consistently found that listeners
        identify familiar recordings from remarkably short fragments, often well under a
        second, when the fragment happens to contain the right part of the song.
      </p>
      <p>
        That last clause is the whole game. Clip length is not really measuring how well you
        know the song. It is measuring <strong>whether the clip contains the identifying
        moment</strong>, and whether the moment arrives early enough to beat the rest of the
        room to it.
      </p>
      <p>
        Which is why the same person can name a song in three seconds and completely miss a
        song they know better — the second one just opens with eight bars of ambient pad.
      </p>

      <h2>Why the intro is the hard part</h2>
      <p>
        Clips typically start at or near the beginning of the preview, which means the game
        is testing intros, and intros are the least distinctive part of most recordings.
        Vocals have not started. The hook has not landed. A lot of songs open with the same
        four chords at the same tempo with the same drum sound.
      </p>
      <p>This has two practical consequences:</p>
      <ul>
        <li>
          <strong>Very short clips reward a specific kind of knowledge</strong> — production
          detail, drum sounds, the exact timbre of a synth — rather than broad familiarity.
          The person who wins at five seconds is not necessarily the person who knows the
          most music.
        </li>
        <li>
          <strong>Adding seconds does not add difficulty linearly.</strong> Going from five
          to ten seconds is a huge change, because ten seconds usually reaches the first
          vocal line. Going from twenty to thirty barely changes anything: if twenty seconds
          did not do it, thirty will not either.
        </li>
      </ul>

      <h2>What each setting actually feels like</h2>
      <table>
        <thead>
          <tr>
            <th>Length</th>
            <th>The room</th>
            <th>Use it when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>5s</strong></td>
            <td>Silence, then one person shouting. Long gaps between scores.</td>
            <td>Tie-breakers, final rounds, groups who have played a lot.</td>
          </tr>
          <tr>
            <td><strong>10s</strong></td>
            <td>Two or three people close in at once. Loud, competitive, fast.</td>
            <td>The default for a group that knows the playlist&rsquo;s era.</td>
          </tr>
          <tr>
            <td><strong>15s</strong></td>
            <td>Almost everyone gets there; the question is who first.</td>
            <td>Mixed-confidence groups. The safest choice for a first game.</td>
          </tr>
          <tr>
            <td><strong>20–30s</strong></td>
            <td>People start singing along. Less quiz, more party.</td>
            <td>Big groups, background play, drinking, families.</td>
          </tr>
        </tbody>
      </table>

      <h2>Longer clips are not just easier — they are a different activity</h2>
      <p>
        This is the part hosts underestimate. Somewhere around twenty seconds, a room stops
        competing and starts singing. The clip outlasts the guess, so once the answer is
        obvious there are fifteen seconds left with nothing to do but enjoy the song.
      </p>
      <p>
        That is not a failure. For a family gathering, a big loud party, or a group who do
        not all know each other yet, it is often the better outcome — the music is doing the
        social work and the scoring is an excuse. But choose it deliberately. A host who
        wants a tense quiz and sets 30 seconds has chosen a sing-along by accident.
      </p>

      <h2>Match the length to the playlist, not just the people</h2>
      <p>
        A playlist of songs with unmistakable openings — a distinctive riff, an instantly
        placeable synth — supports five and ten second clips beautifully. A playlist of
        songs that ease in needs fifteen or more before there is anything to grab.
      </p>
      <p>
        If you are not sure which you have, look at the first few tracks and ask whether you
        would know them from the first bar alone. If the answer is no more than once or
        twice, do not run short clips.{" "}
        <a href="/guides/best-playlists-for-a-guess-the-song-game">
          More on building a playlist that supports short clips.
        </a>
      </p>

      <h2>Change it mid-game</h2>
      <p>
        The best use of this setting is not choosing it once. It is moving it.
      </p>
      <ul>
        <li>
          <strong>Start long, finish short.</strong> Open at 15 or 20 seconds so everyone
          scores something early, then drop to 10 once the room is warm and to 5 for the
          last few. The night feels like it is tightening, which is a much better shape than
          a flat difficulty.
        </li>
        <li>
          <strong>Lengthen when the room goes quiet.</strong> Two or three songs in a row
          with no guesses means the setting is wrong, not that the players are bad. Add five
          seconds without commentary and carry on.
        </li>
        <li>
          <strong>Shorten when one person is running away with it.</strong> Counter-intuitive
          but effective: at very short clips, results get noisier, and noise favours whoever
          is behind. It is a fairer handicap than any rule you could impose on a person.
        </li>
      </ul>

      <h2>A rule of thumb</h2>
      <p>
        Pick the length at which the <strong>third-best</strong> player in the room gets
        about half of them. Not the best player — tuning to them makes the game
        unwinnable for everyone else. Not the least confident — tuning to them makes it
        trivial. The third-best is close enough to the middle that the game stays live for
        the whole room, which is the only thing difficulty settings are for.
      </p>
    </GuideShell>
  );
}
