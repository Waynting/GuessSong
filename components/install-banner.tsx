"use client";

import { useEffect, useState } from "react";
import { subscribeInstall, promptInstall } from "@/lib/pwa";

/**
 * Install pitch banner for content pages (e.g. /about). Renders nothing
 * until the browser signals installability, and hides itself once the
 * prompt has been answered either way (Chrome won't re-prompt anyway).
 */
export function InstallBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => subscribeInstall(setAvailable), []);

  if (!available) return null;

  async function handleInstall() {
    await promptInstall();
    setAvailable(false);
  }

  return (
    <>
      <style>{`
        .install-banner {
          display: flex;
          align-items: center;
          gap: 16px;
          text-align: left;
          background: rgba(29,185,84,0.06);
          border: 1px solid rgba(29,185,84,0.25);
          border-radius: 16px;
          padding: 18px 20px;
          font-family: 'Outfit', sans-serif;
        }
        .install-banner-emoji { font-size: 28px; flex-shrink: 0; }
        .install-banner-title { font-size: 15px; font-weight: 600; color: #f0f0f0; line-height: 1.3; }
        .install-banner-desc { font-size: 13px; color: #999; margin-top: 4px; line-height: 1.5; font-weight: 300; }
        .install-banner-btn {
          margin-left: auto;
          flex-shrink: 0;
          padding: 11px 22px;
          background: #1DB954;
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 14px;
          font-weight: 700;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          box-shadow: 0 4px 24px rgba(29,185,84,0.3);
        }
        .install-banner-btn:hover { background: #1ed760; transform: translateY(-1px); }
        @media (max-width: 560px) {
          .install-banner { flex-direction: column; text-align: center; }
          .install-banner-btn { margin-left: 0; width: 100%; }
        }
      `}</style>
      <div className="install-banner">
        <span className="install-banner-emoji" aria-hidden>
          📲
        </span>
        <span>
          <span className="install-banner-title" style={{ display: "block" }}>
            Install GuessSong
          </span>
          <span className="install-banner-desc" style={{ display: "block" }}>
            Share any playlist from the Spotify app straight to GuessSong and
            start playing — no copy-pasting links.
          </span>
        </span>
        <button className="install-banner-btn" onClick={handleInstall}>
          Install
        </button>
      </div>
    </>
  );
}
