import { ImageResponse } from "next/og";

// See app/icon.tsx: `runtime = "edge"` opts the route out of static generation,
// so this 1200x630 render ran on demand. It is the single most expensive render
// in the app (~125KB PNG) and it is fetched by link crawlers, i.e. once per
// share — the hottest thing in a viral loop. Built once, now.
export const alt = "GuessSong — Spotify Party Game";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Radial green glow */}
        <div
          style={{
            position: "absolute",
            width: 700,
            height: 700,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(29,185,84,0.25) 0%, rgba(29,185,84,0) 70%)",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />

        {/* Music note icon */}
        <div
          style={{
            fontSize: 72,
            marginBottom: 16,
            display: "flex",
          }}
        >
          🎵
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: "-2px",
            background: "linear-gradient(135deg, #1DB954 0%, #4ade80 100%)",
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
            marginBottom: 16,
          }}
        >
          GuessSong
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 32,
            color: "#aaaaaa",
            marginBottom: 48,
            display: "flex",
          }}
        >
          Play a clip. Guess the song. Win the party.
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: 20,
          }}
        >
          {["Any Spotify Playlist", "No Login Required", "Local Multiplayer"].map(
            (pill) => (
              <div
                key={pill}
                style={{
                  display: "flex",
                  padding: "10px 24px",
                  borderRadius: 999,
                  border: "1px solid rgba(29,185,84,0.4)",
                  background: "rgba(29,185,84,0.1)",
                  color: "#1DB954",
                  fontSize: 22,
                  fontWeight: 600,
                }}
              >
                {pill}
              </div>
            )
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
