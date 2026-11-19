"use client";

/**
 * The daily challenge's result on its Game Over (lib/daily.ts): "Daily #N",
 * five squares, "k/5", one Share button.
 *
 * A result about the player — the music-age bet — in the one shape people
 * already paste into chats. The grid names no song, so a friend who opens the
 * link today plays the same five unspoiled.
 *
 * Counted the loop's three ways: shown (`loop_impression` for `daily`, from
 * an effect on mount — which is why the page renders this only behind a
 * computed result, never hidden with CSS), shared with the sheet's outcome
 * (`daily_share:<outcome>`), and followed (`/r/daily`). The link is the
 * counting redirect's production URL (`loopUrl`), never the tab's.
 *
 * Inline styles like `components/music-age.tsx`; the button takes the order
 * page's `btn-ghost` classes, which carry `:active` and the hover behind
 * `(hover: hover)`.
 */

import { useEffect, useState } from "react";
import { loopUrl } from "@/lib/loop-links";
import { reportDailyShare, reportLoopImpression } from "@/lib/loop-client";
import { COPIED_FLASH_MS, shareLink, type ShareLinkOutcome } from "@/lib/quiz-share";
import { dailyShareMessage, dailyShareText, gridScore } from "@/lib/daily";
import { ORDER_COPY, type OrderLocale } from "@/lib/order-copy";

/**
 * Share a day's grid, and count the outcome. The one share path for both
 * cards — this one and the setup page's "done today" card — so the two cannot
 * word it or count it differently. The sheet gets the line and the link
 * apart (`text`, `url`); the clipboard gets them as one message.
 */
export async function shareDaily(
  number: number,
  grid: readonly boolean[],
  locale: OrderLocale = "en"
): Promise<ShareLinkOutcome> {
  const outcome = await shareLink(
    { url: loopUrl("daily"), text: dailyShareText(number, grid, locale), title: "GuessSong" },
    dailyShareMessage(number, grid, locale)
  );
  reportDailyShare(outcome);
  return outcome;
}

/** The five squares, drawn rather than typed, so they look the same on every platform. */
export function DailyGrid({ grid, label, size = 28 }: { grid: readonly boolean[]; label: string; size?: number }) {
  return (
    <div style={{ display: "flex", gap: "6px" }} role="img" aria-label={label}>
      {grid.map((ok, i) => (
        <span
          key={i}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: "5px",
            background: ok ? "#1DB954" : "#2a2a2a",
            border: ok ? "none" : "1px solid #3a3a3a",
          }}
        />
      ))}
    </div>
  );
}

export function DailyResultCard({
  number,
  grid,
  locale = "en",
}: {
  number: number;
  grid: readonly boolean[];
  /** The game payload's language (lib/order-copy.ts). */
  locale?: OrderLocale;
}) {
  const [copied, setCopied] = useState(false);
  const copy = ORDER_COPY[locale].daily;
  const score = gridScore(grid);

  useEffect(() => {
    reportLoopImpression("daily");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function share() {
    const outcome = await shareDaily(number, grid, locale);
    if (outcome === "copied") setCopied(true);
  }

  return (
    <div
      className="daily-result"
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
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: "26px",
            letterSpacing: "0.04em",
            color: "#1DB954",
            lineHeight: 1.1,
          }}
        >
          {copy.title(number)}
        </div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "26px", color: "#f0f0f0", lineHeight: 1.1 }}>
          {score}/{grid.length}
        </div>
      </div>
      <div style={{ margin: "10px 0 8px" }}>
        <DailyGrid grid={grid} label={copy.gridAria(score, grid.length)} />
      </div>
      <p style={{ fontSize: "13px", color: "#aaa", margin: "0 0 12px", lineHeight: 1.45 }}>
        {copy.scoreLine(score, grid.length)}. {copy.body}
      </p>
      <button
        className="btn-ghost compact"
        onClick={share}
        style={{ width: "100%", color: "#1DB954", borderColor: "rgba(29,185,84,0.5)", whiteSpace: "normal" }}
      >
        {copied ? copy.copied : copy.share}
      </button>
      <p style={{ fontSize: "12px", color: "#666", margin: "10px 0 0", textAlign: "center" }}>{copy.tomorrow}</p>
    </div>
  );
}
