"use client";

/**
 * A friend's "beat my score" game, on its Game Over (`lib/challenge.ts`): the
 * two scores side by side.
 *
 * **The "Challenge a friend" button is gone (2026-11-19).** It shared a link
 * carrying the deal and the score, and read zero friends started; the daily
 * challenge (`lib/daily.ts`, `components/daily-result.tsx`) replaced it as
 * the shared-deal mechanic. What stays is the arrival path for links already
 * sent: `/r/challenge` still forwards, the setup page still shows the banner
 * and deals the same cards, and this card still says who won —
 * `challenge:<won|lost|tied>` is still counted by the order page. Nothing
 * here reports a `challenge` impression any more: there is no link on it to
 * follow, so a `click:challenge` with no `shown` is expected from now on.
 *
 * Inline styles like `components/music-age.tsx`. Words by the game payload's
 * locale (`lib/order-copy.ts`).
 */

import { challengeResultLine, type ChallengeScore } from "@/lib/challenge";
import { ORDER_COPY, type OrderLocale } from "@/lib/order-copy";

export function OrderChallenge({
  score,
  against,
  locale = "en",
}: {
  /** This game's score. */
  score: number;
  /** The friend's score this game was played against. */
  against: ChallengeScore;
  /** The game payload's language (lib/order-copy.ts). */
  locale?: OrderLocale;
}) {
  const copy = ORDER_COPY[locale].challenge;
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
        {challengeResultLine(score, against.score, locale)}
      </div>
      <p style={{ fontSize: "13px", color: "#aaa", margin: 0, lineHeight: 1.45 }}>{copy.againstBody}</p>
    </div>
  );
}
