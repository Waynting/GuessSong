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
          flex-direction: column;
          gap: 14px;
          text-align: left;
          background: rgba(29,185,84,0.06);
          border: 1px solid rgba(29,185,84,0.3);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
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
        .install-banner-btn:hover { background: #1ed760; transform: translateY(-1px); }

        .share-flow {
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(29,185,84,0.18);
          border-radius: 10px;
          padding: 12px 14px;
        }
        .share-flow-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #1DB954;
          margin-bottom: 8px;
        }
        .share-flow-steps {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .share-flow-step {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          color: #ddd;
          white-space: nowrap;
        }
        .share-flow-arrow { color: #1DB954; font-size: 13px; font-weight: 700; }
        .share-flow-note {
          font-size: 11px;
          color: #777;
          line-height: 1.5;
          font-weight: 300;
          margin-top: 8px;
        }

        .install-banner-help {
          font-size: 12px;
          color: #999;
          line-height: 1.6;
          font-weight: 300;
          border-top: 1px solid rgba(29,185,84,0.15);
          padding-top: 10px;
        }
        .install-banner-help strong { color: #ccc; font-weight: 600; }
      `}</style>
      <div className="install-banner">
        <div className="install-banner-row">
          <span className="install-banner-emoji" aria-hidden>
            📲
          </span>
          <span className="install-banner-text">
            <span className="install-banner-title" style={{ display: "block" }}>
              Install GuessSong as an app
            </span>
            <span className="install-banner-desc" style={{ display: "block" }}>
              Runs in its own window — and shows up in your phone&apos;s share
              menu.
            </span>
          </span>
          <button className="install-banner-btn" onClick={handleInstall}>
            Install
          </button>
        </div>

        <div className="share-flow">
          <p className="share-flow-label">After installing</p>
          <div className="share-flow-steps">
            <span className="share-flow-step">
              <span aria-hidden>🎵</span> Open a playlist in Spotify
            </span>
            <span className="share-flow-arrow" aria-hidden>
              →
            </span>
            <span className="share-flow-step">
              <span aria-hidden>📤</span> Tap Share
            </span>
            <span className="share-flow-arrow" aria-hidden>
              →
            </span>
            <span className="share-flow-step">
              <span aria-hidden>📲</span> Choose GuessSong
            </span>
          </div>
          <p className="share-flow-note">
            The playlist imports automatically — no copy-pasting links. Sharing
            from Spotify works on Android; on iPhone and desktop, paste the
            link below instead.
          </p>
        </div>

        {showHelp && (
          <span className="install-banner-help">
            Your browser didn&apos;t offer an automatic install — add it
            manually: <strong>Android Chrome</strong>: menu ⋮ →{" "}
            <strong>Install app</strong> (or <strong>Add to Home screen</strong>
            ). <strong>Desktop Chrome</strong>: install icon in the address
            bar, or menu ⋮ → <strong>Cast, save and share</strong> →{" "}
            <strong>Install page as app</strong>. <strong>iPhone Safari</strong>
            : Share → <strong>Add to Home Screen</strong>.
          </span>
        )}
      </div>
    </>
  );
}
