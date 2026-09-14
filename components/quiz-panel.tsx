"use client";

/**
 * What the host sees once their quiz exists: the link, and every way to move
 * it. Inline styles, because it sits on `app/page.tsx`, which is styled that
 * way throughout.
 *
 * The share button prefers the share sheet — that is where a link goes into a
 * group chat from a phone — and falls back to the clipboard on a laptop. The
 * QR is for the room the host is sitting in, which is not the case this
 * feature was built for but costs one dependency already in the bundle
 * (`components/room-panel.tsx` uses the same one).
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { trackEvent } from "@/lib/analytics";
import { QUIZ_COPY, ownerShareText } from "@/lib/quiz-copy";
import { quizUrl } from "@/lib/quiz-session";
import { COPIED_FLASH_MS, copyLink, shareLink } from "@/lib/quiz-share";

export function QuizPanel({
  code,
  ownerName,
  playlistName,
  questionCount,
  expiresAt,
}: {
  code: string;
  ownerName: string | null;
  playlistName: string;
  questionCount: number;
  expiresAt: number;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = quizUrl(code);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  }

  async function handleShare() {
    // The setup page is English by convention; the sentence itself comes from
    // the same table the friend's page renders, so the two cannot drift.
    const text = ownerShareText(QUIZ_COPY.en, { ownerName, playlistName, questionCount });
    const outcome = await shareLink({ url, text, title: "GuessSong taste quiz" });
    if (outcome === "copied") flashCopied();
    trackEvent("quiz_share_tapped", { by: "owner", outcome });
  }

  async function handleCopy() {
    const outcome = await copyLink(url);
    if (outcome === "copied") flashCopied();
    trackEvent("quiz_share_tapped", { by: "owner", outcome });
  }

  const expires = new Date(expiresAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="card" style={{ padding: "24px", textAlign: "center" }}>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>
        {questionCount} questions from
      </p>
      <p style={{ fontSize: "15px", fontWeight: 500, marginBottom: "16px", color: "#f0f0f0" }}>
        {playlistName}
      </p>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element -- client-generated data: URI
        <img
          src={qr}
          alt={`QR code for quiz ${code}`}
          style={{ width: "160px", height: "160px", margin: "0 auto 12px", borderRadius: "8px" }}
        />
      )}
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
          marginBottom: "14px",
        }}
      >
        {url.replace(/^https?:\/\//, "")}
      </a>
      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
        <button className="start-btn" style={{ width: "auto", padding: "12px 24px" }} onClick={handleShare}>
          Send to friends →
        </button>
        <button className="add-player-btn" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy link"}
        </button>
      </div>
      <a href={`/q/${code.toUpperCase()}/board`} className="link-btn" style={{ marginTop: "14px" }}>
        See results — who knows you best →
      </a>
      {/* A constraint, not a caption: one notch up from the 12px #666 captions. */}
      <p style={{ fontSize: "13px", color: "#999", marginTop: "8px", lineHeight: 1.5 }}>
        Results are only visible on this device.
      </p>
      <p style={{ fontSize: "12px", color: "#666", marginTop: "4px", lineHeight: 1.5 }}>
        The link stops working on {expires}.
      </p>
    </div>
  );
}
