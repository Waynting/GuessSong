"use client";

import { useEffect, useState } from "react";
import { promptInstall, isStandalone } from "@/lib/pwa";
import { getHostGameCount } from "@/lib/host-session";

/**
 * Install pitch on the home page: one row above the setup form.
 *
 * Shown only to a device that has hosted a game before. A first visit is
 * someone deciding whether to paste a playlist at all, and this block used to
 * sit between the title and the form on every one of them — a three-step
 * share-from-Spotify walkthrough plus a paragraph of per-OS instructions,
 * selling a shortcut that only pays off for the host who comes back. Hidden
 * by default so the server never renders it, and gone for good once the app
 * is installed or already running standalone.
 *
 * Install is never a dead end: when the browser offers no native prompt, one
 * line points at its own menu.
 */
export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // The share target — Spotify's share sheet listing GuessSong — only exists on
  // Android. Pitching it to an iPhone promises a menu item that is not there.
  const [sharesFromSpotify, setSharesFromSpotify] = useState(false);

  useEffect(() => {
    if (isStandalone() || getHostGameCount() < 1) return;
    setSharesFromSpotify(/Android/i.test(navigator.userAgent));
    setVisible(true);
    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (!visible) return null;

  async function handleInstall() {
    const outcome = await promptInstall();
    // No native prompt available (unsupported browser, already dismissed,
    // criteria not met yet) — say where the manual one lives.
    if (outcome === null) setShowHelp(true);
  }

  return (
    <>
      <style>{`
        .install-banner {
          display: flex;
          flex-direction: column;
          gap: 10px;
          text-align: left;
          background: rgba(29,185,84,0.06);
          border: 1px solid rgba(29,185,84,0.3);
          border-radius: 12px;
          padding: 14px 16px;
          margin-top: 16px;
          font-family: 'Outfit', sans-serif;
        }
        .install-banner-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
        }
        .install-banner-emoji { font-size: 22px; flex-shrink: 0; }
        .install-banner-text { flex: 1; min-width: 180px; }
        .install-banner-title { font-size: 14px; font-weight: 600; color: #f0f0f0; line-height: 1.3; }
        .install-banner-desc { font-size: 12px; color: #999; margin-top: 3px; line-height: 1.45; font-weight: 300; }
        .install-banner-btn {
          flex-shrink: 0;
          padding: 9px 18px;
          background: #1DB954;
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 700;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        @media (hover: hover) { .install-banner-btn:hover { background: #1ed760; transform: translateY(-1px); } }
        .install-banner-btn:active { transform: scale(0.97); transition: none; }
        .install-banner-help {
          font-size: 12px;
          color: #999;
          line-height: 1.5;
          font-weight: 300;
          border-top: 1px solid rgba(29,185,84,0.15);
          padding-top: 10px;
        }
      `}</style>
      <div className="install-banner">
        <div className="install-banner-row">
          <span className="install-banner-emoji" aria-hidden>
            📲
          </span>
          <span className="install-banner-text">
            <span className="install-banner-title" style={{ display: "block" }}>
              Install GuessSong
            </span>
            <span className="install-banner-desc" style={{ display: "block" }}>
              {sharesFromSpotify
                ? "Share a playlist from Spotify straight into the game."
                : "Open it from your home screen next time."}
            </span>
          </span>
          <button className="install-banner-btn" onClick={handleInstall}>
            Install
          </button>
        </div>

        {showHelp && (
          <p className="install-banner-help">
            Install it from your browser&apos;s menu.
          </p>
        )}
      </div>
    </>
  );
}
