"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import type { Track } from "@/types";
import { DEFAULT_SAMPLED_PER_PLAYER, type RoomSubmissionSummary, type RoomPoolResponse } from "@/types/room";
import { trackEvent } from "@/lib/analytics";
import { REPORT_PROBLEM_MAILTO } from "@/lib/contact";
import { buildGamePayload, GAME_STORAGE_KEY } from "@/lib/game-session";
import { BUILTIN_PLAYLISTS, type BuiltinPlaylist } from "@/lib/builtin-playlists";
import { InstallBanner } from "@/components/install-banner";
import {
  MixedPlaylistCollector,
  type MixedContribution,
} from "@/components/mixed-playlist-collector";
import { poolContributions } from "@/lib/mixed-playlist";

const CLIP_DURATIONS = [5, 10, 15, 20, 30];
const SONG_COUNTS: (number | "all")[] = [10, 20, 30, 50, "all"];
const MIXED_SAMPLE_COUNTS = [5, 8, 10, 12];
const MIXED_MIN_CONTRIBUTORS = 2;
const ROOM_POLL_INTERVAL_MS = 4000;

type SetupMode = "single" | "mixed";
type MixedSubMode = "room" | "phone";

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
  const [setupMode, setSetupMode] = useState<SetupMode>("single");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [players, setPlayers] = useState<string[]>(["", ""]);
  const [clipDuration, setClipDuration] = useState(15);
  const [songCount, setSongCount] = useState<number | "all">(20);
  const [mixedContributions, setMixedContributions] = useState<MixedContribution[]>([]);
  const [sampledPerPlayer, setSampledPerPlayer] = useState(DEFAULT_SAMPLED_PER_PLAYER);
  const [mixedSubMode, setMixedSubMode] = useState<MixedSubMode>("room");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [roomSubmissions, setRoomSubmissions] = useState<RoomSubmissionSummary[]>([]);
  const [roomCreating, setRoomCreating] = useState(false);
  const [roomStarting, setRoomStarting] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const roomPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomSubmissionTotalRef = useRef(0);

  function addMixedContribution(c: MixedContribution) {
    setMixedContributions((prev) => [...prev, c]);
  }

  function removeMixedContribution(idx: number) {
    setMixedContributions((prev) => prev.filter((_, i) => i !== idx));
  }

  function stopRoomPolling() {
    if (roomPollIntervalRef.current) {
      clearInterval(roomPollIntervalRef.current);
      roomPollIntervalRef.current = null;
    }
  }

  async function pollRoomStatus(code: string) {
    try {
      const res = await fetch(`/api/room/${code}/status`);
      const data = await res.json();
      if (!res.ok) return;
      setRoomSubmissions(data.submissions);
      if (data.total > roomSubmissionTotalRef.current) {
        roomSubmissionTotalRef.current = data.total;
        trackEvent("room_submission_received", { total: data.total });
      }
    } catch {
      // Transient network hiccup while polling — the next tick retries.
    }
  }

  async function handleCreateRoom() {
    setRoomError(null);
    setRoomCreating(true);
    try {
      const res = await fetch("/api/room", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create room");

      setRoomCode(data.roomCode);
      setHostToken(data.hostToken);
      roomSubmissionTotalRef.current = 0;
      setRoomSubmissions([]);
      trackEvent("room_created", {});

      const url = `${window.location.origin}/j/${data.roomCode}`;
      setJoinUrl(url);
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
      setQrDataUrl(dataUrl);

      stopRoomPolling();
      roomPollIntervalRef.current = setInterval(
        () => pollRoomStatus(data.roomCode),
        ROOM_POLL_INTERVAL_MS
      );
    } catch (e: unknown) {
      setRoomError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRoomCreating(false);
    }
  }

  async function handleShareJoinLink() {
    if (!joinUrl) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url: joinUrl, title: `Join room ${roomCode} on GuessSong` });
        return;
      } catch (e) {
        // User closed the share sheet — not an error, fall through to copy.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(joinUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the QR code and visible code remain usable.
    }
  }

  async function handleRoomStart() {
    if (!roomCode || !hostToken) return;
    setRoomError(null);
    setRoomStarting(true);
    try {
      const res = await fetch(`/api/room/${roomCode}/pool?sampledPerPlayer=${sampledPerPlayer}`, {
        headers: { "x-host-token": hostToken },
      });
      const data: RoomPoolResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start game");
      stopRoomPolling();

      const payload = buildGamePayload({
        tracks: data.tracks,
        players: data.players.map((name) => ({ name, score: 0 })),
        playlistName: `${data.players.length}-Player Mix`,
        clipDuration,
        totalTracks: data.tracks.length,
        playlistSource: "mixed",
        mode: "party",
        mixedPlaylistMeta: {
          contributorNames: data.players,
          sampledPerPlayer: data.sampledPerPlayer,
        },
      });
      sessionStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(payload));
      trackEvent("game_started", {
        player_count: data.players.length,
        clip_duration: clipDuration,
        song_count: data.tracks.length,
        playlist_source: "mixed",
      });
      trackEvent("room_started", {
        contributor_count: data.players.length,
        unique_tracks: data.tracks.length,
      });
      router.push("/game");
    } catch (e: unknown) {
      setRoomError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRoomStarting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    // Prefill from the share target redirect (/share → /?playlist=...).
    const shared = new URLSearchParams(window.location.search).get("playlist");
    if (shared) setPlaylistUrl(shared);
    return () => stopRoomPolling();
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
      const limited = songCount === "all" ? shuffled : shuffled.slice(0, songCount);

      const payload = buildGamePayload({
        tracks: limited,
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
        song_count: limited.length,
        playlist_source: "own",
      });
      router.push("/game");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleMixedStart() {
    setError(null);
    if (mixedContributions.length < MIXED_MIN_CONTRIBUTORS) {
      setError(`Add at least ${MIXED_MIN_CONTRIBUTORS} players' playlists to start`);
      return;
    }
    setLoading(true);
    trackEvent("playlist_submitted", { playlist_source: "mixed" });
    try {
      const results = await Promise.allSettled(
        mixedContributions.map(async (c) => {
          const res = await fetch("/api/playlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: c.playlistUrl }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to load playlist");
          return { playerName: c.name, tracks: data.tracks as Track[] };
        })
      );

      const failedNames = results
        .map((r, i) => (r.status === "rejected" ? mixedContributions[i].name : null))
        .filter((n): n is string => n !== null);
      if (failedNames.length > 0) {
        throw new Error(
          `Couldn't load a playlist for: ${failedNames.join(", ")}. Remove or fix them and try again.`
        );
      }

      const contributions = (
        results as PromiseFulfilledResult<{ playerName: string; tracks: Track[] }>[]
      ).map((r) => r.value);
      const totalRawTracks = contributions.reduce((sum, c) => sum + c.tracks.length, 0);
      const pooled = poolContributions(contributions, sampledPerPlayer);
      const overlapCount = pooled.filter((t) => t.contributors.length > 1).length;

      const payload = buildGamePayload({
        tracks: pooled,
        players: mixedContributions.map((c) => ({ name: c.name, score: 0 })),
        playlistName: `${mixedContributions.length}-Player Mix`,
        clipDuration,
        totalTracks: pooled.length,
        playlistSource: "mixed",
        mode: "party",
        mixedPlaylistMeta: {
          contributorNames: mixedContributions.map((c) => c.name),
          sampledPerPlayer,
        },
      });
      sessionStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(payload));
      trackEvent("game_started", {
        player_count: mixedContributions.length,
        clip_duration: clipDuration,
        song_count: pooled.length,
        playlist_source: "mixed",
      });
      trackEvent("mixed_pool_built", {
        contributor_count: mixedContributions.length,
        unique_tracks: pooled.length,
        total_raw_tracks: totalRawTracks,
        overlap_count: overlapCount,
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

        .link-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 999px;
          border: 1.5px solid rgba(29,185,84,0.35);
          background: rgba(29,185,84,0.06);
          color: var(--green);
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          transition: border-color 0.15s, background 0.15s, transform 0.1s;
        }
        .link-btn:hover {
          border-color: var(--green);
          background: rgba(29,185,84,0.12);
          transform: translateY(-1px);
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
            <p style={{ color: "#666", fontSize: "15px", marginTop: "12px", fontWeight: 300 }}>
              Play a clip. Guess the song. Compete.
            </p>
            <p style={{ color: "#555", fontSize: "12px", marginTop: "8px" }}>
              Paste any public Spotify playlist URL — no login required
            </p>
            <p style={{ color: "#555", fontSize: "12px", marginTop: "4px" }}>
              猜歌遊戲・派對音樂猜謎，適合朋友聚會
            </p>
            <p style={{ marginTop: "10px" }}>
              <a href="/about" className="link-btn">How to play →</a>
            </p>
            <p style={{ color: "#555", fontSize: "13px", marginTop: "8px", fontWeight: 300, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              If you like, give me a star
              <a href="https://github.com/Waynting/GuessSong" target="_blank" rel="noopener noreferrer" style={{ color: "#555", display: "inline-flex", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "#f0f0f0")} onMouseLeave={e => (e.currentTarget.style.color = "#555")}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-label="GitHub">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </a>
            </p>
          </div>

          {/* Install pitch — shown before the setup form */}
          <div className={mounted ? "fade-in fade-in-2" : ""}>
            <InstallBanner />
          </div>

          {/* Card */}
          <div className={`card ${mounted ? "fade-in fade-in-2" : ""}`} style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Game Mode */}
            <div>
              <p className="section-label">Game Mode</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className={`pill${setupMode === "single" ? " active" : ""}`}
                  onClick={() => setSetupMode("single")}
                >
                  Single Playlist
                </button>
                <button
                  className={`pill${setupMode === "mixed" ? " active" : ""}`}
                  onClick={() => setSetupMode("mixed")}
                >
                  Mixed Playlist 🔀
                </button>
              </div>
              {setupMode === "mixed" && (
                <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
                  Pass this phone around — everyone adds their own playlist, then we mix them together.
                </p>
              )}
            </div>

            {setupMode === "single" ? (
              <>
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
              </>
            ) : (
              <>
                {/* Collection sub-mode */}
                <div>
                  <p className="section-label">How to Collect</p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      className={`pill${mixedSubMode === "room" ? " active" : ""}`}
                      onClick={() => setMixedSubMode("room")}
                    >
                      QR Code
                    </button>
                    <button
                      className={`pill${mixedSubMode === "phone" ? " active" : ""}`}
                      onClick={() => setMixedSubMode("phone")}
                    >
                      Pass This Phone
                    </button>
                  </div>
                </div>

                {mixedSubMode === "phone" ? (
                  <div>
                    <p className="section-label">Collect Playlists</p>
                    <MixedPlaylistCollector
                      contributions={mixedContributions}
                      onAdd={addMixedContribution}
                      onRemove={removeMixedContribution}
                    />
                  </div>
                ) : (
                  <div>
                    <p className="section-label">Room</p>
                    {!roomCode ? (
                      <div className="card" style={{ padding: "24px", textAlign: "center" }}>
                        <p style={{ fontSize: "13px", color: "#777", marginBottom: "16px" }}>
                          Generate a QR code — players scan it to add their own playlist from
                          their own phone.
                        </p>
                        <button
                          className="start-btn"
                          onClick={handleCreateRoom}
                          disabled={roomCreating}
                        >
                          {roomCreating ? "Creating Room..." : "Create Room"}
                        </button>
                        {roomError && (
                          <p style={{ marginTop: "10px", fontSize: "12px", color: "#fca5a5" }}>
                            {roomError}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="card" style={{ padding: "24px", textAlign: "center" }}>
                        <p
                          style={{
                            fontFamily: "'Bebas Neue', sans-serif",
                            fontSize: "36px",
                            letterSpacing: "0.12em",
                            color: "#1DB954",
                            marginBottom: "12px",
                          }}
                        >
                          {roomCode}
                        </p>
                        {qrDataUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={qrDataUrl}
                            alt={`QR code to join room ${roomCode}`}
                            style={{
                              width: "180px",
                              height: "180px",
                              margin: "0 auto 12px",
                              borderRadius: "8px",
                            }}
                          />
                        )}
                        <button
                          className="add-player-btn"
                          onClick={handleShareJoinLink}
                          style={{ marginBottom: "14px" }}
                        >
                          {linkCopied ? "✓ Link copied" : "Share Join Link"}
                        </button>
                        <p style={{ fontSize: "12px", color: "#666", marginBottom: "14px" }}>
                          Can&apos;t scan? Send that link instead — it&apos;s the same thing.
                        </p>
                        <p style={{ fontSize: "12px", color: "#666", marginBottom: "14px" }}>
                          {roomSubmissions.length} player
                          {roomSubmissions.length === 1 ? "" : "s"} joined
                        </p>
                        {roomSubmissions.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                              textAlign: "left",
                            }}
                          >
                            {roomSubmissions.map((s) => (
                              <div
                                key={s.playerName}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  background: "#1a1a1a",
                                  border: "1px solid #2a2a2a",
                                  borderRadius: "8px",
                                  padding: "10px 14px",
                                  fontSize: "14px",
                                }}
                              >
                                <span>{s.playerName}</span>
                                <span style={{ color: "#666" }}>{s.trackCount} tracks</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {roomError && (
                          <p style={{ marginTop: "12px", fontSize: "12px", color: "#fca5a5" }}>
                            {roomError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Songs per Player */}
                <div>
                  <p className="section-label">Songs Per Player</p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {MIXED_SAMPLE_COUNTS.map((c) => (
                      <button
                        key={c}
                        className={`pill${sampledPerPlayer === c ? " active" : ""}`}
                        onClick={() => setSampledPerPlayer(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
                    Caps how many tracks each player&apos;s playlist contributes, after duplicates are merged.
                  </p>
                </div>
              </>
            )}

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

            {/* Number of Songs — single-playlist mode only; mixed mode uses per-player sampling instead */}
            {setupMode === "single" && (
              <div>
                <p className="section-label">Number of Songs</p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {SONG_COUNTS.map((c) => (
                    <button
                      key={c}
                      className={`pill${songCount === c ? " active" : ""}`}
                      onClick={() => setSongCount(c)}
                    >
                      {c === "all" ? "All" : c}
                    </button>
                  ))}
                </div>
                <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
                  How many tracks to play from the shuffled playlist.
                </p>
              </div>
            )}

            {/* Start Button */}
            <div>
              {(() => {
                const isMixedPhone = setupMode === "mixed" && mixedSubMode === "phone";
                const isMixedRoom = setupMode === "mixed" && mixedSubMode === "room";
                const phoneShort = MIXED_MIN_CONTRIBUTORS - mixedContributions.length;
                const roomShort = MIXED_MIN_CONTRIBUTORS - roomSubmissions.length;
                const busy = loading || roomStarting;
                const disabled =
                  busy ||
                  (isMixedPhone && mixedContributions.length < MIXED_MIN_CONTRIBUTORS) ||
                  (isMixedRoom && (!roomCode || roomSubmissions.length < MIXED_MIN_CONTRIBUTORS));
                const onClick = setupMode === "single"
                  ? handleStart
                  : isMixedPhone
                  ? handleMixedStart
                  : handleRoomStart;

                let label: ReactNode = "Start Game →";
                if (busy) {
                  label = (
                    <>
                      <span className="spinner" />
                      Loading playlist
                      <span className="dot-pulse" />
                    </>
                  );
                } else if (isMixedPhone && phoneShort > 0) {
                  label = `Add ${phoneShort} more player${phoneShort === 1 ? "" : "s"} to start`;
                } else if (isMixedRoom && !roomCode) {
                  label = "Create a room first";
                } else if (isMixedRoom && roomShort > 0) {
                  label = `Waiting for ${roomShort} more player${roomShort === 1 ? "" : "s"}`;
                }

                return (
                  <button className="start-btn" onClick={onClick} disabled={disabled}>
                    {label}
                  </button>
                );
              })()}

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

          {/* Footer */}
          <footer style={{ textAlign: "center", marginTop: "32px", paddingTop: "20px", borderTop: "1px solid var(--border)" }}>
            <a href={REPORT_PROBLEM_MAILTO} className="link-btn">Report a problem</a>
          </footer>

        </div>
      </main>
    </>
  );
}
