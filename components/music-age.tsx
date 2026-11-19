"use client";

/**
 * "Your ears live in 1987" — the order game's Game Over result about the
 * player (lib/music-age.ts).
 *
 * The invite card beside it asks someone alone to invite a group, and read
 * one real send in 2,089 views. People alone share results about themselves,
 * so this card is one: a year, the decade it sits in, one button.
 *
 * Counted the loop's three ways: shown (`loop_impression`, from an effect on
 * mount — which is why the page renders this only behind a computed age,
 * never hidden with CSS), tapped with the share sheet's outcome
 * (`music_age:<outcome>`), and followed (`/r/music_age`, a friend opening the
 * link). The link is the counting redirect's production URL, never
 * `window.location`.
 *
 * Inline styles, like `components/solo-invite.tsx`: it renders inside the
 * order page's own stylesheet, whose `btn-ghost` class supplies the button's
 * `:active` and its hover behind `(hover: hover)`.
 */

import { useEffect, useState } from "react";
import { loopUrl } from "@/lib/loop-links";
import { reportLoopImpression, reportMusicAge } from "@/lib/loop-client";
import { COPIED_FLASH_MS, shareLink } from "@/lib/quiz-share";
import { musicAgeCopy, type MusicAge } from "@/lib/music-age";

export function MusicAgeCard({
  age,
  room,
  locale = "en",
}: {
  age: MusicAge;
  room: boolean;
  /** The game payload's language (lib/order-copy.ts). */
  locale?: "en" | "pt";
}) {
  const [copied, setCopied] = useState(false);
  const copy = musicAgeCopy(age, room, locale);

  useEffect(() => {
    reportLoopImpression("music_age");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function share() {
    const url = loopUrl("music_age");
    const outcome = await shareLink(
      { url, text: copy.shareText, title: "GuessSong" },
      `${copy.shareText} ${url}`
    );
    reportMusicAge(outcome);
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
      <div
        style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: "24px",
          letterSpacing: "0.04em",
          color: "#1DB954",
          lineHeight: 1.1,
        }}
      >
        {copy.headline}
      </div>
      <p style={{ fontSize: "13px", color: "#aaa", margin: "6px 0 12px", lineHeight: 1.45 }}>{copy.line}</p>
      <button
        className="btn-ghost compact"
        onClick={share}
        // Green over the class's grey: it is the card's one action. The
        // class still supplies :active's background and press scale.
        style={{ width: "100%", color: "#1DB954", borderColor: "rgba(29,185,84,0.5)", whiteSpace: "normal" }}
      >
        {copied ? copy.copied : copy.button}
      </button>
    </div>
  );
}
