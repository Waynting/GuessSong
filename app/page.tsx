"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { buildGamePayload, GAME_STORAGE_KEY } from "@/lib/game-session";
import { BUILTIN_PLAYLISTS, type BuiltinPlaylist } from "@/lib/builtin-playlists";

const CLIP_DURATIONS = [5, 10, 15, 20, 30];

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WaveformBg() {
  const bars = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      <div className="absolute bottom-0 left-0 right-0 h-64 flex items-end justify-center gap-[3px] opacity-[0.06]">
        {bars.map((i) => (
          <div
            key={i}
            className="waveform-bar bg-[#1DB954] rounded-t-sm"
            style={{
              width: "3px",
              height: `${(20 + Math.sin(i * 0.4) * 15 + Math.sin(i * 0.9) * 20 + Math.cos(i * 0.7) * 15).toFixed(2)}%`,
              animationDelay: `${(i * 0.05) % 2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [players, setPlayers] = useState<string[]>(["", ""]);
  const [clipDuration, setClipDuration] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isValidSpotifyUrl = playlistUrl.includes("spotify.com/playlist") || playlistUrl.includes("spotify:playlist:");
  const isEditorial = playlistUrl.includes("37i9");

  function addPlayer() {
    setPlayers((p) => [...p, ""]);
  }

  function removePlayer(idx: number) {
    setPlayers((p) => p.filter((_, i) => i !== idx));
  }

  function updatePlayer(idx: number, val: string) {
    setPlayers((p) => p.map((v, i) => (i === idx ? val : v)));
  }

  async function handleStart() {
    setError(null);
    const validPlayers = players.filter((p) => p.trim());
    if (!playlistUrl.trim()) {
      setError("Please enter a Spotify playlist URL");
      return;
    }
    if (validPlayers.length < 1) {
      setError("Add at least one player");
      return;
    }
    setLoading(true);
    trackEvent("playlist_submitted", { playlist_source: "own" });
    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load playlist");

      const shuffled = [...data.tracks].sort(() => Math.random() - 0.5);

      const payload = buildGamePayload({
        tracks: shuffled,
        players: validPlayers.map((name) => ({ name, score: 0 })),
        playlistName: data.name,
        clipDuration,
        totalTracks: data.totalTracks,
        playlistSource: "own",
        mode: "party",
      });
      sessionStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(payload));
      trackEvent("game_started", {
        player_count: validPlayers.length,
        clip_duration: clipDuration,
        playlist_source: "own",
      });
      router.push("/game");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleQuickStart(playlist: BuiltinPlaylist) {
    const shuffled = [...playlist.tracks].sort(() => Math.random() - 0.5);
    const payload = buildGamePayload({
      tracks: shuffled,
      players: [{ name: "You", score: 0 }],
      playlistName: playlist.name,
      clipDuration,
      playlistSource: "builtin",
      mode: "trial",
    });
    sessionStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(payload));
    trackEvent("game_started", {
      player_count: 1,
      clip_duration: clipDuration,
      playlist_source: "builtin",
    });
    router.push("/game");
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');

        :root {
          --green: #1DB954;
          --green-dim: #169c44;
          --bg: #111111;
          --surface: #1a1a1a;
          --surface2: #222222;
          --border: #2a2a2a;
          --text: #f0f0f0;
          --muted: #777;
        }

        body { background: var(--bg); font-family: 'Outfit', sans-serif; color: var(--text); }

        .hero-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(2.8rem, 8vw, 6rem);
          letter-spacing: 0.02em;
          line-height: 0.9;
          background: linear-gradient(135deg, #ffffff 0%, #aaffc8 40%, #1DB954 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: none;
        }

        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
        }

        .url-input {
          width: 100%;
          background: var(--surface2);
          border: 1.5px solid var(--border);
          border-radius: 10px;
          padding: 14px 48px 14px 16px;
          font-size: 15px;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }
        .url-input:focus {
          border-color: var(--green);
          box-shadow: 0 0 0 3px rgba(29,185,84,0.12);
        }
        .url-input.valid { border-color: var(--green); }
        .url-input::placeholder { color: var(--muted); }

        .player-input {
          flex: 1;
          background: var(--surface2);
          border: 1.5px solid var(--border);
          border-radius: 8px;
          padding: 11px 14px;
          font-size: 14px;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          outline: none;
          transition: border-color 0.2s;
        }
        .player-input:focus { border-color: var(--green); }
        .player-input::placeholder { color: var(--muted); }

        .pill {
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
          border: 1.5px solid var(--border);
          background: var(--surface2);
          color: var(--muted);
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Outfit', sans-serif;
        }
        .pill:hover { border-color: #444; color: var(--text); }
        .pill.active {
          background: var(--green);
          border-color: var(--green);
          color: #000;
          box-shadow: 0 0 16px rgba(29,185,84,0.4);
        }

        .start-btn {
          width: 100%;
          padding: 16px;
          background: var(--green);
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 18px;
          font-weight: 700;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          letter-spacing: 0.03em;
          transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
          box-shadow: 0 4px 24px rgba(29,185,84,0.3);
        }
        .start-btn:hover:not(:disabled) {
          background: #1ed760;
          box-shadow: 0 4px 32px rgba(29,185,84,0.5);
          transform: translateY(-1px);
        }
        .start-btn:active:not(:disabled) { transform: translateY(0); }
        .start-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .add-player-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 500;
          color: var(--green);
          background: none;
          border: 1.5px dashed rgba(29,185,84,0.4);
          border-radius: 8px;
          padding: 9px 16px;
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Outfit', sans-serif;
          width: 100%;
          justify-content: center;
        }
        .add-player-btn:hover {
          border-color: var(--green);
          background: rgba(29,185,84,0.05);
        }

        .remove-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--muted);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .remove-btn:hover { background: #3a1a1a; border-color: #662222; color: #ef4444; }

        .section-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 10px;
        }

        .trial-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 24px 0 14px;
        }
        .trial-divider::before, .trial-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }
        .trial-divider span {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          white-space: nowrap;
        }

        .trial-card {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 14px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px 16px;
          cursor: pointer;
          text-align: left;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          transition: border-color 0.15s, background 0.15s, transform 0.1s;
        }
        .trial-card:hover {
          border-color: var(--green);
          background: rgba(29,185,84,0.05);
          transform: translateY(-1px);
        }
        .trial-card:active { transform: translateY(0); }
        .trial-card-emoji {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          background: var(--surface2);
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          flex-shrink: 0;
        }
        .trial-card-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          line-height: 1.2;
        }
        .trial-card-desc {
          font-size: 12px;
          color: var(--muted);
          margin-top: 3px;
          line-height: 1.4;
        }
        .trial-card-arrow {
          margin-left: auto;
          flex-shrink: 0;
          color: var(--green);
          font-size: 18px;
          font-weight: 700;
          opacity: 0.7;
          transition: opacity 0.15s, transform 0.15s;
        }
        .trial-card:hover .trial-card-arrow { opacity: 1; transform: translateX(2px); }

        .waveform-bar {
          animation: waveform 2.4s ease-in-out infinite alternate;
        }
        @keyframes waveform {
          from { transform: scaleY(0.4); }
          to { transform: scaleY(1); }
        }

        .fade-in {
          opacity: 0;
          transform: translateY(16px);
          animation: fadeUp 0.5s ease forwards;
        }
        .fade-in-1 { animation-delay: 0.05s; }
        .fade-in-2 { animation-delay: 0.15s; }
        .fade-in-3 { animation-delay: 0.25s; }
        .fade-in-4 { animation-delay: 0.35s; }
        .fade-in-5 { animation-delay: 0.45s; }
        @keyframes fadeUp {
          to { opacity: 1; transform: translateY(0); }
        }

        .dot-pulse::after {
          content: '...';
          animation: dots 1.2s steps(4, end) infinite;
        }
        @keyframes dots {
          0%, 20% { content: ''; }
          40% { content: '.'; }
          60% { content: '..'; }
          80%, 100% { content: '...'; }
        }

        .spinner {
          width: 20px; height: 20px;
          border: 2.5px solid rgba(0,0,0,0.3);
          border-top-color: #000;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: inline-block;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .noise-overlay {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          opacity: 0.025;
        }
      `}</style>

      <div className="noise-overlay" aria-hidden />
      <WaveformBg />

      {/* Radial glow top-center */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "-20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "400px",
          background: "radial-gradient(ellipse at center, rgba(29,185,84,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px",
          position: "relative",
        }}
      >
        <div style={{ width: "100%", maxWidth: "480px" }}>
          {/* Header */}
          <div className={`text-center mb-8 ${mounted ? "fade-in fade-in-1" : ""}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "8px" }}>
              <div style={{ color: "#1DB954" }}>
                <SpotifyIcon />
              </div>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#777", letterSpacing: "0.08em" }}>
                PARTY GAME
              </span>
            </div>
            <h1 className="hero-title">GuessSong</h1>
            <p style={{ color: "#666", fontSize: "15px", marginTop: "12px", fontWeight: 300, display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
              Play a clip. Guess the song. Compete.
              <a href="https://github.com/Waynting/spotify-song-guess_web" target="_blank" rel="noopener noreferrer" style={{ color: "#555", display: "inline-flex", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "#f0f0f0")} onMouseLeave={e => (e.currentTarget.style.color = "#555")}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-label="GitHub">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </a>
            </p>
          </div>

          {/* Card */}
          <div className={`card ${mounted ? "fade-in fade-in-2" : ""}`} style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Playlist URL */}
            <div>
              <p className="section-label">Spotify Playlist</p>
              <div style={{ position: "relative" }}>
                <input
                  ref={firstInputRef}
                  type="url"
                  className={`url-input${isValidSpotifyUrl ? " valid" : ""}`}
                  placeholder="https://open.spotify.com/playlist/..."
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  spellCheck={false}
                />
                {isValidSpotifyUrl && (
                  <span
                    style={{
                      position: "absolute",
                      right: "14px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#1DB954",
                    }}
                  >
                    <CheckIcon />
                  </span>
                )}
              </div>
              {isEditorial && (
                <p
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    color: "#f59e0b",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>⚠</span> Editorial playlists (Discover Weekly, etc.) may not work
                </p>
              )}
            </div>

            {/* Players */}
            <div>
              <p className="section-label">Players</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {players.map((name, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      className="player-input"
                      placeholder={`Player ${idx + 1}`}
                      value={name}
                      onChange={(e) => updatePlayer(idx, e.target.value)}
                      maxLength={24}
                    />
                    {players.length > 1 && (
                      <button
                        className="remove-btn"
                        onClick={() => removePlayer(idx)}
                        aria-label={`Remove player ${idx + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button className="add-player-btn" onClick={addPlayer}>
                  <span style={{ fontSize: "18px", lineHeight: 1, fontWeight: 300 }}>+</span>
                  Add Player
                </button>
              </div>
            </div>

            {/* Clip Duration */}
            <div>
              <p className="section-label">Clip Duration</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {CLIP_DURATIONS.map((d) => (
                  <button
                    key={d}
                    className={`pill${clipDuration === d ? " active" : ""}`}
                    onClick={() => setClipDuration(d)}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            {/* Start Button */}
            <div>
              <button className="start-btn" onClick={handleStart} disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner" />
                    Loading playlist
                    <span className="dot-pulse" />
                  </>
                ) : (
                  "Start Game →"
                )}
              </button>

              {error && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: "8px",
                    fontSize: "13px",
                    color: "#fca5a5",
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Built-in playlists — zero-friction trial */}
          <div className={mounted ? "fade-in fade-in-3" : ""}>
            <div className="trial-divider">
              <span>Try it now — no playlist needed</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {BUILTIN_PLAYLISTS.map((playlist) => (
                <button
                  key={playlist.id}
                  className="trial-card"
                  onClick={() => handleQuickStart(playlist)}
                >
                  <span className="trial-card-emoji" aria-hidden>
                    {playlist.coverEmoji}
                  </span>
                  <span>
                    <span className="trial-card-name" style={{ display: "block" }}>
                      {playlist.name}
                    </span>
                    <span className="trial-card-desc" style={{ display: "block" }}>
                      {playlist.description} · {playlist.tracks.length} tracks
                    </span>
                  </span>
                  <span className="trial-card-arrow" aria-hidden>
                    →
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Footer note */}
          <p
            className={`text-center ${mounted ? "fade-in fade-in-4" : ""}`}
            style={{ color: "#555", fontSize: "12px", marginTop: "20px" }}
          >
            Paste any public Spotify playlist URL — no login required
          </p>
        </div>
      </main>
    </>
  );
}
