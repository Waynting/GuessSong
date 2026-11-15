"use client";

/**
 * The one-player Game Over's way onward: send the group chat a link, to play
 * it together next time.
 *
 * Since 2026-11-11 most games are one person, alone, from Google. Every other
 * offer on this screen is to a room — a QR for people across it, "everyone
 * brings their own playlist" — and this person has nobody there. What they can
 * do is ask someone for later, so that is the whole card: one sentence of what
 * the game is with friends, and one button.
 *
 * Counted three ways, the loop's own shape: shown (`loop_impression`, from an
 * effect on mount — which is why `gameOverOnward` decides whether it renders
 * rather than CSS hiding it), tapped with the share sheet's outcome
 * (`solo_invite:<outcome>`), and followed (`/r/solo_invite`, a friend opening
 * the link). The link is the counting redirect's production URL, never
 * `window.location`: it is opened another day, from a chat.
 *
 * Inline styles, like `components/loop-qr.tsx`: it renders inside the two game
 * pages' own stylesheets, and every control there carries a `:active` and a
 * hover behind `(hover: hover)` — which is why the button is styled by a class
 * those pages already define (`btn-ghost`), not here.
 */

import { useEffect, useState } from "react";
import { loopUrl } from "@/lib/loop-links";
import { reportLoopImpression, reportSoloInvite } from "@/lib/loop-client";
import { COPIED_FLASH_MS, shareLink } from "@/lib/quiz-share";
import { SOLO_INVITE_COPY, type SoloInviteGame } from "@/lib/solo-invite-copy";

export function SoloInvite({ game }: { game: SoloInviteGame }) {
  const [copied, setCopied] = useState(false);
  const copy = SOLO_INVITE_COPY[game];

  useEffect(() => {
    reportLoopImpression("solo_invite");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function invite() {
    const url = loopUrl("solo_invite");
    const outcome = await shareLink(
      { url, text: copy.shareText, title: "GuessSong" },
      `${copy.shareText} ${url}`
    );
    reportSoloInvite(outcome);
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
          fontSize: "20px",
          letterSpacing: "0.06em",
          color: "#1DB954",
          lineHeight: 1.1,
        }}
      >
        {copy.headline}
      </div>
      <p style={{ fontSize: "13px", color: "#aaa", margin: "6px 0 12px", lineHeight: 1.45 }}>{copy.body}</p>
      <button
        className="btn-ghost compact"
        onClick={invite}
        // Green over the class's grey: it is the card's one action. The
        // class still supplies :active's background and press scale.
        style={{ width: "100%", color: "#1DB954", borderColor: "rgba(29,185,84,0.5)", whiteSpace: "normal" }}
      >
        {copied ? "Link copied ✓" : copy.button}
      </button>
    </div>
  );
}
