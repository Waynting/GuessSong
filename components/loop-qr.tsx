"use client";

/**
 * A scannable way off the host's screen, for the room to use.
 *
 * The Game Over screen is the highest-attention surface this product has and
 * the only one it never used: the music has stopped, the host is not touching
 * anything, and every person in the room is looking at a television with their
 * phone already in their hand — because they spent the last half hour buzzing
 * with it. Until now that screen showed scores and two buttons the host does
 * not need help finding.
 *
 * A printed address would be the wrong answer here for the same reason it is
 * the wrong answer on the result card: nobody types a URL off a screen. A QR
 * is the only thing five people can act on at once from across a room.
 *
 * `qrcode` is already a production dependency — `components/buzzer-host-panel`
 * and `components/room-panel` both use it for the join code — so this costs a
 * component and no bundle.
 */

import { useEffect, useState } from "react";
import type { LoopSurface } from "@/lib/loop-links";
import { loopQrDataUrl } from "@/lib/loop-qr";
import { reportLoopImpression } from "@/lib/loop-client";

export function LoopQr({
  surface = "game_over",
  size = 92,
}: {
  surface?: LoopSurface;
  size?: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Always the production URL, never `window.location.origin` — the inverse
    // of the rule for a room QR (`lib/buzzer-client.ts:78`). A room code has to
    // point at the deploy the room lives on; this one is scanned by people who
    // may open it another day, when a preview URL would be dead.
    void loopQrDataUrl(surface, size * 2).then((url) => {
      // A failed render is not worth an error state on a celebration screen;
      // the caption below still names the product.
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [surface, size]);

  // Counted as an impression once per session even when the image fails: the
  // room was shown the surface either way, and quietly dropping those would
  // make the scan rate look better than it is.
  useEffect(() => {
    reportLoopImpression(surface);
  }, [surface]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginTop: "14px",
        flexShrink: 0,
      }}
    >
      {dataUrl && (
        /* eslint-disable-next-line @next/next/no-img-element -- a data: URL
           generated at runtime; next/image would add a loader for nothing. */
        <img
          src={dataUrl}
          alt=""
          width={size}
          height={size}
          style={{ borderRadius: "6px", display: "block" }}
        />
      )}
      <div style={{ textAlign: "left" }}>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: "20px",
            letterSpacing: "0.06em",
            color: "#1DB954",
            lineHeight: 1.1,
          }}
        >
          GuessSong
        </div>
        <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>
          Scan to host your own party
        </div>
      </div>
    </div>
  );
}
