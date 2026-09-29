"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trackEvent, type ShareType } from "@/lib/analytics";

/**
 * What was shared, and what to share instead — and the instead is always a
 * playlist *somebody made*.
 *
 * Every entry here used to send people to a playlist they would then be
 * refused for. The artist one said "like a This Is playlist you saved", and
 * "This Is …" playlists are Spotify's own: their ids begin `37i9` and the
 * server turns every one of them away (`playlist_editorial`). "The playlist
 * that song lives in" and "any playlist you like" are the same trap with
 * less signposting — the playlists Spotify shows beside a song, an album or
 * an artist are mostly its own. A page whose whole job is the next step
 * must not make the next step a second refusal.
 *
 * The album entry also promised support ("on the roadmap", "yet"). Whether
 * albums are worth building is what `playlist_invalid:album` is measuring;
 * until that is read there is nothing to promise, so this says what works
 * today. The same rule as `playlist_link_album` in lib/error-messages.ts,
 * which is this sentence on the paste path. `tests/playlist-link-copy.test.ts`
 * reads this table for all of it.
 */
const COPY: Record<ShareType, { title: string; body: string }> = {
  track: {
    title: "That's a single track",
    body: "GuessSong needs a whole playlist to build a game. Share a public playlist you made yourself — add this song to it first if you like.",
  },
  album: {
    title: "That's an album",
    body: "GuessSong plays playlists. Add the album's songs to a playlist of your own, make it public, and share that playlist.",
  },
  artist: {
    title: "That's an artist page",
    body: "GuessSong plays playlists. Add the artist's songs to a playlist of your own, make it public, and share that playlist.",
  },
  unknown: {
    title: "Couldn't find a playlist link",
    body: "We couldn't spot a Spotify playlist link in what you shared. In Spotify, open a playlist you made → tap ⋯ → Share → GuessSong.",
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
        @media (hover: hover) {
          .home-btn:hover { background: #1ed760; transform: translateY(-1px); }
        }
        .home-btn:active { background: #1aa34a; transform: none; transition: none; }
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
            Tip: the playlist has to be public, and made by a person. Private
            playlists can&apos;t be loaded, and neither can Spotify&apos;s own —
            Today&apos;s Top Hits, Discover Weekly, anything called &ldquo;This
            Is&rdquo;.
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
