"use client";

/**
 * "Beat my score" on a one-player order Game Over (`lib/challenge.ts`).
 *
 * A plain invitation converted 1 send in 2,089; a score to beat might. The
 * button shares a link that carries the deal (playlist ref, seed, song count)
 * and the score — no names, it goes to a group chat — and a friend who opens
 * it plays the same cards. On a friend's own Game Over the card leads with
 * the two scores side by side, and the button sends their score back.
 *
 * Counted the loop's way: shown (`loop_impression`, from an effect on mount,
 * which is why the page decides whether it renders), tapped with the share
 * sheet's outcome (`challenge:share:<outcome>`), followed (`/r/challenge`).
 * The link is the counting redirect's production URL, never `window.location`.
 *
 * Inline styles like `components/solo-invite.tsx`; the button takes the order
 * page's `btn-ghost` classes, which carry the `:active` and the hover behind
 * `(hover: hover)`.
 */

import { useEffect, useState } from "react";
import { reportChallengeShare, reportLoopImpression } from "@/lib/loop-client";
import { COPIED_FLASH_MS, shareLink } from "@/lib/quiz-share";
import {
  challengeButtonLabel,
  challengeResultLine,
  challengeShareText,
  challengeShareUrl,
  type ChallengeDeal,
  type ChallengeScore,
} from "@/lib/challenge";

export function OrderChallenge({
  deal,
  against,
}: {
  /** This game's deal and score — what the button sends. */
  deal: ChallengeDeal;
  /** The friend's score this game was played against, when it was a challenge. */
  against: ChallengeScore | null;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    reportLoopImpression("challenge");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function challenge() {
    const url = challengeShareUrl(deal);
    const text = challengeShareText(deal.score, deal.max);
    const outcome = await shareLink({ url, text, title: "GuessSong" }, `${text} ${url}`);
    reportChallengeShare(outcome);
    if (outcome === "copied") setCopied(true);
  }

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "14px 16px",
        borderRadius: "12px",
        border: "1px solid rgba(29,185,84,0.35)",
        background: "rgba(29,185,84,0.06)",
        textAlign: "left",
        width: "100%",
        maxWidth: "380px",
        flexShrink: 0,
      }}
    >
      {against && (
        <div
          className="challenge-result"
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: "22px",
            letterSpacing: "0.04em",
            color: "#1DB954",
            lineHeight: 1.15,
            marginBottom: "8px",
          }}
        >
          {challengeResultLine(deal.score, against.score)}
        </div>
      )}
      <p style={{ fontSize: "13px", color: "#aaa", margin: "0 0 12px", lineHeight: 1.45 }}>
        {against
          ? "Same songs, same order. Send your score back and see if they can top it."
          : `You scored ${deal.score} of ${deal.max}. Send a friend the same songs and see if they can beat it.`}
      </p>
      <button
        className="btn-ghost compact"
        onClick={challenge}
        style={{ width: "100%", color: "#1DB954", borderColor: "rgba(29,185,84,0.5)", whiteSpace: "normal" }}
      >
        {copied ? "Link copied ✓" : challengeButtonLabel(deal.score, against !== null)}
      </button>
    </div>
  );
}
