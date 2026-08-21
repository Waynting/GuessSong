import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, guideMetadata } from "@/app/guides/guide-shell";

const SLUG = "party-games-for-small-groups";

export const metadata: Metadata = guideMetadata(SLUG);

export default function Page() {
  return (
    <GuideShell slug={SLUG}>
      <p>
        Party games are mostly designed for one of two sizes: two or three people at a
        table, or a crowd. The awkward middle — four to twelve, one room, everyone can hear
        each other — has a specific failure mode that most games walk straight into.
      </p>
      <p>
        It is not boredom. It is <strong>elimination</strong>. The person knocked out in the
        first five minutes now has thirty-five minutes of watching. At a party of forty
        that is fine, because they can go and talk to someone else. At a party of eight,
        they are a quarter of the room and there is nowhere to go.
      </p>
      <p>
        So the property to select for at this size is simple: <em>can everyone stay in every
        round?</em> Here are games that pass, and what each is actually good at.
      </p>

      <h2>Music guessing</h2>
      <p>
        <strong>Best for: 4–12 · Needs: a speaker · Setup: about a minute</strong>
      </p>
      <p>
        Play a short clip, everyone shouts the title, fastest correct answer scores. It
        passes the test structurally — every player is live on every clip, and being behind
        does not reduce your chances on the next song.
      </p>
      <p>
        What makes it unusually good at this size is that it needs no reading, no writing and
        no turn order, so the conversation never stops. People talk over it, argue about
        whether that was the same song as the last one, and sing along. It is one of the few
        games that improves rather than collapses when people are not fully concentrating.
      </p>
      <p>
        The variant worth knowing about: instead of everyone guessing the same playlist, have
        everyone submit their own, merge them, and guess{" "}
        <Link href="/guides/mixed-playlist-mode-guide">whose playlist each song came from</Link>.
        That version works with as few as four people and gets better the less alike the
        group&rsquo;s taste is.
      </p>
      <p>
        <strong>Weakness:</strong> one person who knows every song can flatten it. Fixable —{" "}
        <Link href="/guides/music-quiz-scoring-rules">the scoring guide covers five ways</Link>.
      </p>

      <h2>Two Truths and a Lie</h2>
      <p>
        <strong>Best for: 5–10 · Needs: nothing · Setup: none</strong>
      </p>
      <p>
        Everyone states three things about themselves; the room votes on which is invented.
        The reason it endures is that it does double duty — it is a game and it is the
        fastest way for a group who half-know each other to actually learn something.
      </p>
      <p>
        <strong>Weakness:</strong> it is turn-based, so at ten people each player is active
        for two minutes and passive for eighteen. Keep it to one round.
      </p>

      <h2>Fishbowl</h2>
      <p>
        <strong>Best for: 6–12 · Needs: paper, a bowl · Setup: five minutes</strong>
      </p>
      <p>
        Everyone writes several names or phrases onto slips. Three rounds with the same
        slips: describe them freely, then in one word, then mime them. The joke is that by
        round three everyone remembers the slips, so the constraint gets funnier as the
        information gets easier.
      </p>
      <p>
        The best structural game on this list — genuinely team-based, no elimination, and the
        escalating format means it peaks rather than fades.
      </p>
      <p>
        <strong>Weakness:</strong> the setup is real, and it needs an even split into teams.
      </p>

      <h2>Werewolf and its relatives</h2>
      <p>
        <strong>Best for: 7–12 · Needs: a moderator · Setup: ten minutes</strong>
      </p>
      <p>
        Superb when it works, and it is the clearest example of the failure this page is
        about: it eliminates players by design, and the ones eliminated first are eliminated
        for the whole game. Under about eight players it also stops functioning as a
        deduction game.
      </p>
      <p>
        Play it when the group is at the top of this size range, has played before, and
        someone is genuinely willing to moderate rather than play. Otherwise it is a long
        setup for a game some people stop being in.
      </p>

      <h2>Drawing games</h2>
      <p>
        <strong>Best for: 4–12 · Needs: paper or phones · Setup: minimal</strong>
      </p>
      <p>
        The write-a-phrase, draw-it, guess-it, draw-that chain. Everyone is active
        simultaneously, artistic ability is irrelevant and arguably a handicap, and the
        output is the point — the reveal at the end is what people photograph.
      </p>
      <p>
        <strong>Weakness:</strong> it goes quiet. Everyone is looking down at their own paper
        or phone for most of it, so it is a poor choice if the room has not warmed up yet.
      </p>

      <h2>Choosing between them</h2>
      <table>
        <thead>
          <tr>
            <th>If the group is…</th>
            <th>Play</th>
            <th>Because</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Strangers, just arrived</td>
            <td>Two Truths, then music</td>
            <td>Names first, competition second</td>
          </tr>
          <tr>
            <td>Old friends</td>
            <td>Mixed-playlist music, Fishbowl</td>
            <td>Both reward shared history</td>
          </tr>
          <tr>
            <td>Loud and half-distracted</td>
            <td>Music guessing</td>
            <td>The only one that survives inattention</td>
          </tr>
          <tr>
            <td>Wide age range</td>
            <td>Music guessing, drawing</td>
            <td>No reading speed, no cultural gatekeeping</td>
          </tr>
          <tr>
            <td>Only four people</td>
            <td>Music guessing</td>
            <td>Most of the others need six-plus</td>
          </tr>
          <tr>
            <td>Twelve, and up for a project</td>
            <td>Fishbowl or Werewolf</td>
            <td>Both need the numbers to work</td>
          </tr>
        </tbody>
      </table>

      <h2>Three rules that apply to all of them</h2>
      <ol>
        <li>
          <strong>Start before everyone has arrived.</strong> Waiting for the last two people
          costs more energy than starting without them. A game already running is easier to
          join than a game being explained.
        </li>
        <li>
          <strong>Stop while people still want more.</strong> The single highest-value rule
          in this entire subject. Ending one round early is what makes a group ask to play
          again; ending one round late is what makes them remember it as long.
        </li>
        <li>
          <strong>Have exactly one person deciding.</strong> Not a committee. Groups of this
          size are notoriously bad at choosing a game — twenty minutes of &ldquo;I don&rsquo;t
          mind, what do you want to do&rdquo; kills more evenings than any bad game ever has.
          Pick one, announce it, start it.
        </li>
      </ol>

      <h2>The two-minute default</h2>
      <p>
        If you want a game that needs no equipment, no explanation and no minimum group size,
        put on a playlist everyone half-knows, play ten seconds of a random track, and let
        the room shout. It is the lowest-setup thing on this page and it works from four
        people to twenty.
      </p>
      <p>
        <Link href="/guides/how-to-host-a-music-quiz-night">
          How to run it so it holds up for a full evening
        </Link>{" "}
        is the longer version.
      </p>
    </GuideShell>
  );
}
