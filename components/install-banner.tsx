"use client";

import { useEffect, useState } from "react";
import { promptInstall, isStandalone } from "@/lib/pwa";

/**
 * Install pitch block on the home page, shown above the setup form.
 * Always visible (it never hides on click — only once the app is actually
 * installed or already running standalone). Clicking Install triggers the
 * native prompt when the browser offers one; otherwise it expands manual
 * "add to home screen" instructions so the button is never a dead end.
 */
export function InstallBanner() {
  const [hidden, setHidden] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) setHidden(true);
    const onInstalled = () => setHidden(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (hidden) return null;

  async function handleInstall() {
    const outcome = await promptInstall();
    // No native prompt available (unsupported browser, already dismissed,
    // criteria not met yet) — show manual instructions instead.
    if (outcome === null) setShowHelp(true);
  }

  return (
    <>
      <style>{`
        .install-banner {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          text-align: left;
          background: rgba(29,185,84,0.06);
          border: 1px solid rgba(29,185,84,0.25);
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 16px;
          font-family: 'Outfit', sans-serif;
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
        .install-banner-btn:hover { background: #1ed760; transform: translateY(-1px); }
        .install-banner-help {
          width: 100%;
          font-size: 12px;
          color: #999;
          line-height: 1.6;
          font-weight: 300;
          border-top: 1px solid rgba(29,185,84,0.15);
          padding-top: 10px;
          margin-top: 2px;
        }
        .install-banner-help strong { color: #ccc; font-weight: 600; }
      `}</style>
      <div className="install-banner">
        <span className="install-banner-emoji" aria-hidden>
          📲
        </span>
        <span className="install-banner-text">
          <span className="install-banner-title" style={{ display: "block" }}>
            Install GuessSong
          </span>
          <span className="install-banner-desc" style={{ display: "block" }}>
            Share any playlist from the Spotify app straight to GuessSong.
          </span>
        </span>
        <button className="install-banner-btn" onClick={handleInstall}>
          Install
        </button>
        {showHelp && (
          <span className="install-banner-help">
            Your browser didn&apos;t offer an automatic install — add it
            manually: <strong>Android Chrome</strong>: menu ⋮ →{" "}
            <strong>Install app</strong> (or <strong>Add to Home screen</strong>
            ). <strong>iPhone Safari</strong>: Share →{" "}
            <strong>Add to Home Screen</strong>. Note: the Spotify share
            shortcut only works on Android.
          </span>
        )}
      </div>
    </>
  );
}
