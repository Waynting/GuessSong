"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trackEvent, type ShareType } from "@/lib/analytics";

const COPY: Record<ShareType, { title: string; body: string }> = {
  track: {
    title: "That's a single track",
    body: "GuessSong needs a playlist to build a game. Open the playlist that song lives in (or any playlist you like) and share that instead.",
  },
  album: {
    title: "Albums aren't supported yet",
    body: "Album support is on the roadmap. For now, share a playlist — or try one of the built-in playlists on the home page.",
  },
  artist: {
    title: "That's an artist page",
    body: "GuessSong needs a playlist to build a game. Open one of the artist's playlists (like a This Is playlist you saved) and share that instead.",
  },
  unknown: {
    title: "Couldn't find a playlist link",
    body: "We couldn't spot a Spotify playlist URL in what you shared. In Spotify, open a playlist → tap ⋯ → Share → GuessSong. The playlist must be public.",
  },
};

function readType(): ShareType {
  const t = new URLSearchParams(window.location.search).get("type");
  return t === "track" || t === "album" || t === "artist" ? t : "unknown";
}

export default function ShareUnsupportedPage() {
  const [type, setType] = useState<ShareType | null>(null);

  useEffect(() => {
    const t = readType();
    setType(t);
    trackEvent("share_unsupported", { share_type: t });
  }, []);

  const copy = COPY[type ?? "unknown"];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');
        body { background: #111111; font-family: 'Outfit', sans-serif; color: #f0f0f0; }
        .unsupported-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(2rem, 6vw, 3rem);
          letter-spacing: 0.02em;
          line-height: 1;
          color: #f0f0f0;
        }
        .home-btn {
          display: inline-block;
          padding: 14px 28px;
          background: #1DB954;
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 16px;
          font-weight: 700;
          border-radius: 12px;
          text-decoration: none;
          box-shadow: 0 4px 24px rgba(29,185,84,0.3);
          transition: background 0.15s, transform 0.1s;
        }
        .home-btn:hover { background: #1ed760; transform: translateY(-1px); }
      `}</style>
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "440px" }}>
          <div style={{ fontSize: "44px", marginBottom: "16px" }} aria-hidden>
            🎧
          </div>
          <h1 className="unsupported-title">{copy.title}</h1>
          <p
            style={{
              color: "#999",
              fontSize: "15px",
              lineHeight: 1.6,
              marginTop: "16px",
            }}
          >
            {copy.body}
          </p>
          <p style={{ color: "#666", fontSize: "13px", lineHeight: 1.6, marginTop: "12px" }}>
            Tip: private playlists can&apos;t be loaded — set the playlist to
            public in Spotify first.
          </p>
          <div style={{ marginTop: "32px" }}>
            <Link className="home-btn" href="/?utm_source=share_unsupported">
              Go to GuessSong →
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
