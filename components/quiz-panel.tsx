"use client";

/**
 * What the host sees once their quiz exists: the link, and every way to move
 * it. Inline styles, because it sits on `/quiz` (`app/quiz/quiz-create.tsx`),
 * which is styled that way throughout.
 *
 * What leaves this panel — the share sentence, the sheet title — lands in the
 * host's group chat, in whatever language that chat is in, next to a friend's
 * page that already renders in it. So the panel reads from the same
 * `QUIZ_COPY[locale]` table the friend's page does, and the two cannot drift.
 *
 * The share button prefers the share sheet — that is where a link goes into a
 * group chat from a phone — and falls back to the clipboard on a laptop. The
 * QR is for the room the host is sitting in, which is not the case this
 * feature was built for but costs one dependency already in the bundle
 * (`components/room-panel.tsx` uses the same one).
 *
 * ## Two buttons, two counters
 *
 * Send and Copy used to end in one `settle()` and one `reportQuizShare`, so
 * `quiz_share:owner:copied` was two things added together: the share button
 * falling back to the clipboard on a browser with no share sheet, and a
 * deliberate tap on Copy. It read 17 of 19 taps in the week to 2026-09-29 and
 * could not say which. Each button now reports through its own function —
 * `reportQuizShare` and `reportQuizCopy` — and only what the host *sees* is
 * shared between them (`show`). A handler here that calls the other button's
 * reporter type-checks and puts the two meanings back.
 *
 * ## It also comes back
 *
 * The same panel is drawn for a quiz made on an earlier visit
 * (`recallLastQuiz`), which is why `questionCount` can be null: an entry
 * written before the count was kept has none, and the caption and the share
 * sentence both say less rather than print one.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { reportQuizCopy, reportQuizShare } from "@/lib/loop-client";
import type { ErrorLocale } from "@/lib/error-messages";
import {
  QUIZ_COPY,
  fillCopy,
  formatQuizDate,
  ownerClipboardText,
  ownerShareText,
  panelCaption,
} from "@/lib/quiz-copy";
import { quizUrl } from "@/lib/quiz-session";
import { COPIED_FLASH_MS, copyLink, shareLink, type ShareLinkOutcome } from "@/lib/quiz-share";

export function QuizPanel({
  code,
  ownerName,
  playlistName,
  questionCount,
  expiresAt,
  locale,
}: {
  code: string;
  ownerName: string | null;
  playlistName: string;
  /** Null for a remembered quiz whose count this device did not keep. */
  questionCount: number | null;
  expiresAt: number;
  locale: ErrorLocale;
}) {
  const copy = QUIZ_COPY[locale];
  const [qr, setQr] = useState<string | null>(null);
  // One slot, not two flags: "copied" flashes and clears, "failed" stays up
  // until the next attempt settles it. They cannot both be true, and the
  // failed line lasting past the flash is the point — the host reads it and
  // long-presses the link, which is the thing that still works.
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  const url = quizUrl(code);
  const quiz = { ownerName, playlistName, questionCount };

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  function flashCopied() {
    setFeedback("copied");
    setTimeout(() => setFeedback((f) => (f === "copied" ? null : f)), COPIED_FLASH_MS);
  }

  /**
   * What the host sees for each outcome, whichever button produced it.
   * `shared` and `dismissed` show nothing: the sheet was on screen, so they
   * already know. `failed` used to show nothing too — a tap that did nothing,
   * on the one button the whole feature turns on — so it now names the
   * fallback that always works. Reports nothing: that is each handler's own
   * line, below, and keeping it out of here is what keeps the keys apart.
   */
  function show(outcome: ShareLinkOutcome) {
    if (outcome === "copied") flashCopied();
    else if (outcome === "failed") setFeedback("failed");
    else if (outcome === "shared") setFeedback(null);
  }

  // Both buttons put the sentence and the link on the clipboard, the way the
  // taker's share always has: a bare address pasted into a chat says nothing
  // about what it is until — unless — the card draws.
  async function handleShare() {
    const outcome = await shareLink(
      { url, text: ownerShareText(copy, quiz), title: copy.panelShareTitle },
      ownerClipboardText(copy, quiz, url)
    );
    show(outcome);
    reportQuizShare("owner", outcome);
  }

  async function handleCopy() {
    const outcome = await copyLink(ownerClipboardText(copy, quiz, url));
    show(outcome);
    reportQuizCopy("owner", outcome);
  }

  return (
    <div className="card" style={{ padding: "24px", textAlign: "center" }}>
      {/* Both lines or neither: a caption ending in "from" over nothing is
          worse than no caption, and an entry with no playlist name is one
          somebody edited. */}
      {playlistName && (
        <>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>
            {panelCaption(copy, questionCount)}
          </p>
          <p style={{ fontSize: "15px", fontWeight: 500, marginBottom: "16px", color: "#f0f0f0" }}>
            {playlistName}
          </p>
        </>
      )}
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element -- client-generated data: URI
        <img
          src={qr}
          alt={fillCopy(copy.panelQrAlt, { code })}
          style={{ width: "160px", height: "160px", margin: "0 auto 14px", borderRadius: "8px" }}
        />
      )}
      {/* The URL as text appears only when the buttons cannot move it: the
          QR and the two buttons are the link, and a monospace address under
          them was a third copy of the same thing. Announced, so a screen
          reader hears why the button went quiet. Amber rather than red —
          nothing is broken, this browser just does not offer the shortcut. */}
      {feedback === "failed" && (
        <div role="status" style={{ marginBottom: "14px" }}>
          <p style={{ fontSize: "12px", color: "#f59e0b", lineHeight: 1.5 }}>
            {copy.panelShareFailed}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              fontFamily: "monospace",
              fontSize: "13px",
              color: "#1DB954",
              wordBreak: "break-all",
              marginTop: "6px",
            }}
          >
            {url.replace(/^https?:\/\//, "")}
          </a>
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
        <button className="start-btn" style={{ width: "auto", padding: "12px 24px" }} onClick={handleShare}>
          {copy.panelSend}
        </button>
        <button className="add-player-btn" onClick={handleCopy}>
          {feedback === "copied" ? copy.panelCopied : copy.panelCopyLink}
        </button>
      </div>
      {/* The owner's two ways onto their own quiz. The preview is a plain
          link to the address their friends get — no `?owner`, nothing in the
          URL at all: what makes it a preview is this device's token, sent in
          a header by the page it lands on. Wraps to two rows on a phone. */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          justifyContent: "center",
          flexWrap: "wrap",
          marginTop: "14px",
        }}
      >
        <a href={`/q/${code.toUpperCase()}`} className="link-btn">
          {copy.panelPreviewLink}
        </a>
        <a href={`/q/${code.toUpperCase()}/board`} className="link-btn">
          {copy.panelBoardLink}
        </a>
      </div>
      {/* A constraint, not a caption: one notch up from the 12px #666 captions. */}
      <p style={{ fontSize: "13px", color: "#999", marginTop: "8px", lineHeight: 1.5 }}>
        {fillCopy(copy.panelResultsUntil, { date: formatQuizDate(expiresAt, locale) })}
      </p>
    </div>
  );
}
