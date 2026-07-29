"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { trackEvent, type PlaylistSource } from "@/lib/analytics";
import { canInstall, promptInstall } from "@/lib/pwa";
import {
  parseGamePayload,
  countRoundsPlayed,
  GAME_STORAGE_KEY,
  type GameMode,
  type GamePlayer as Player,
} from "@/lib/game-session";
import type { RoundHistoryEntry } from "@/lib/round-history";
import { buildTasteCard } from "@/lib/taste-card";
import {
  createResultCanvas,
  drawCardBackground,
  drawCardHeader,
  drawCardFooter,
  shareOrDownloadCanvas,
} from "@/lib/result-image";

type Phase = "waiting" | "playing" | "guessing" | "revealed" | "finished";

const ALBUM_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%231a1a1a'/%3E%3Ccircle cx='200' cy='200' r='80' fill='%23222'/%3E%3Ccircle cx='200' cy='200' r='20' fill='%23111'/%3E%3C/svg%3E";

function InstallCta({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="install-cta">
      <span className="install-cta-emoji" aria-hidden>
        📲
      </span>
      <span>
        <span className="install-cta-title" style={{ display: "block" }}>
          Install GuessSong
        </span>
        <span className="install-cta-desc" style={{ display: "block" }}>
          Next time, share any playlist from Spotify straight to GuessSong and
          start playing.
        </span>
      </span>
      <button className="install-cta-btn" onClick={onInstall}>
        Install
      </button>
    </div>
  );
}

export default function GamePage() {
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [clipDuration, setClipDuration] = useState(15);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [albumWinner, setAlbumWinner] = useState<string | null>(null);
  const [sourceWinner, setSourceWinner] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [scorePulse, setScorePulse] = useState<string | null>(null);
  const [pointsAwarded, setPointsAwarded] = useState(false);
  const [albumPointsAwarded, setAlbumPointsAwarded] = useState(false);
  const [sourcePointsAwarded, setSourcePointsAwarded] = useState(false);
  const [roundHistory, setRoundHistory] = useState<RoundHistoryEntry[]>([]);
  const [albumHintShown, setAlbumHintShown] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [loadingSkipVisible, setLoadingSkipVisible] = useState(false);
  const [playlistSource, setPlaylistSource] = useState<PlaylistSource>("own");
  const [mode, setMode] = useState<GameMode>("party");
  const [installCta, setInstallCta] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCache = useRef<Record<string, string | null>>({});
  const gameStartTimeRef = useRef<number>(Date.now());
  const finishedTrackedRef = useRef(false);
  const roundsPlayedRef = useRef(0);

  const isTrial = mode === "trial";

  // Show the PWA install pitch at the high-intent moment: game over.
  useEffect(() => {
    if (phase === "finished") setInstallCta(canInstall());
  }, [phase]);

  async function handleInstall() {
    // Hide regardless of outcome: the deferred prompt is consumed either way,
    // so a second click could never do anything.
    await promptInstall();
    setInstallCta(false);
  }

  useEffect(() => {
    const raw = sessionStorage.getItem(GAME_STORAGE_KEY);
    if (!raw) { router.push("/"); return; }
    const data = parseGamePayload(raw);
    if (!data || data.tracks.length === 0) { router.push("/"); return; }
    setTracks(data.tracks);
    setPlayers(data.players);
    setPlaylistName(data.playlistName);
    setClipDuration(data.clipDuration);
    setPlaylistSource(data.playlistSource);
    setMode(data.mode);
    gameStartTimeRef.current = Date.now();
  }, [router]);

  const stopClip = useCallback(() => {
    audioRef.current?.pause();
    if (clipTimeoutRef.current) clearTimeout(clipTimeoutRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, []);

  async function playClip() {
    const audio = audioRef.current;
    const track = tracks[currentIndex];
    if (!audio || !track) return;

    // Resolve preview URL — use cache, track field, or fetch from Deezer proxy
    let previewUrl = previewCache.current[track.id] ?? track.previewUrl ?? null;

    if (!previewUrl) {
      setPreviewLoading(true);
      setLoadingSkipVisible(false);
      loadingSkipTimerRef.current = setTimeout(() => setLoadingSkipVisible(true), 1500);
      try {
        const res = await fetch(
          // id keys the server-side cache: the same recording shows up under
          // different name/artist strings across playlists, which would
          // otherwise fragment the cache and re-hit iTunes for a known track.
          `/api/preview?track=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(track.artists[0] ?? "")}&id=${encodeURIComponent(track.id)}`
        );
        const data = await res.json();
        previewUrl = data.previewUrl ?? null;
        previewCache.current[track.id] = previewUrl;
      } catch {
        previewUrl = null;
      }
      if (loadingSkipTimerRef.current) clearTimeout(loadingSkipTimerRef.current);
      setLoadingSkipVisible(false);
      setPreviewLoading(false);
    }

    if (!previewUrl) {
      trackEvent("preview_miss", {
        playlist_source: playlistSource,
        track_name: track.name,
        artist: track.artists[0] ?? "",
      });
      setNoAudio(true);
      return;
    }

    audio.src = previewUrl;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    setPhase("playing");
    setProgress(0);

    const startTime = Date.now();
    progressIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setProgress(Math.min((elapsed / clipDuration) * 100, 100));
    }, 80);

    clipTimeoutRef.current = setTimeout(() => {
      audio.pause();
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setProgress(100);
      setPhase("guessing");
    }, clipDuration * 1000);
  }

  function reveal() {
    stopClip();
    setPhase("revealed");
  }

  function awardPoint(playerName: string) {
    if (pointsAwarded) return;
    setRoundWinner(playerName);
    setPointsAwarded(true);
    setScorePulse(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + 3 } : p))
    );
    setTimeout(() => setScorePulse(null), 600);
  }

  function awardAlbumPoint(playerName: string) {
    if (albumPointsAwarded) return;
    setAlbumWinner(playerName);
    setAlbumPointsAwarded(true);
    setScorePulse(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + 1 } : p))
    );
    setTimeout(() => setScorePulse(null), 600);
  }

  /** Mixed Playlist Mode: +2 for guessing whose playlist the track came from. */
  function awardSourcePoint(playerName: string) {
    if (sourcePointsAwarded) return;
    setSourceWinner(playerName);
    setSourcePointsAwarded(true);
    setScorePulse(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + 2 } : p))
    );
    setTimeout(() => setScorePulse(null), 600);
  }

  /** Mark the current trial round as guessed correctly (+1, once per round). */
  function markTrialCorrect() {
    if (pointsAwarded) return;
    setPointsAwarded(true);
    setPlayers((prev) =>
      prev.map((p, i) => (i === 0 ? { ...p, score: p.score + 1 } : p))
    );
  }

  /** Fire game_finished exactly once (guards endGame + nextTrack double entry). */
  function trackGameFinished() {
    if (finishedTrackedRef.current) return;
    finishedTrackedRef.current = true;
    roundsPlayedRef.current = countRoundsPlayed(currentIndex, phase);
    trackEvent("game_finished", {
      rounds_played: roundsPlayedRef.current,
      total_tracks: tracks.length,
      duration_seconds: Math.round((Date.now() - gameStartTimeRef.current) / 1000),
      playlist_source: playlistSource,
      ...(isTrial ? { correct_count: players[0]?.score ?? 0 } : {}),
    });
  }

  function nextTrack() {
    stopClip();
    trackEvent("round_completed", {
      round_index: currentIndex + 1,
      skipped: phase !== "revealed",
      playlist_source: playlistSource,
    });

    const finishedTrack = tracks[currentIndex];
    if (finishedTrack?.contributors && finishedTrack.contributors.length > 0) {
      setRoundHistory((prev) => [
        ...prev,
        {
          trackId: finishedTrack.id,
          contributors: finishedTrack.contributors!,
          songWinner: roundWinner,
          albumWinner: albumWinner,
          sourceWinner: sourceWinner,
        },
      ]);
    }

    if (currentIndex + 1 >= tracks.length) {
      trackGameFinished();
      setPhase("finished");
    } else {
      setCurrentIndex((i) => i + 1);
      setPhase("waiting");
      setRoundWinner(null);
      setAlbumWinner(null);
      setSourceWinner(null);
      setProgress(0);
      setPointsAwarded(false);
      setAlbumPointsAwarded(false);
      setSourcePointsAwarded(false);
      setAlbumHintShown(false);
      setPreviewLoading(false);
      setNoAudio(false);
      setLoadingSkipVisible(false);
    }
  }

  function endGame() {
    stopClip();
    trackGameFinished();
    setPhase("finished");
  }

  function playAgain() {
    router.push("/");
  }

  async function downloadResultImage() {
    const W = 640;
    const rowH = 64;
    const headerH = 200;
    const footerH = 80;
    const H = headerH + sortedPlayers.length * rowH + footerH;
    const { canvas, ctx } = createResultCanvas(W, H);

    drawCardBackground(ctx, W, H);
    drawCardHeader(ctx, {
      width: W,
      kicker: "GUESS SONG",
      title: "Final Scores",
      subtitle: playlistName,
    });

    // Player rows
    sortedPlayers.forEach((p, idx) => {
      const y = headerH + idx * rowH;
      const isWinner = idx === 0 && p.score === maxScore && maxScore > 0;

      // Row background
      if (isWinner) {
        ctx.fillStyle = "rgba(29,185,84,0.08)";
        ctx.fillRect(24, y + 4, W - 48, rowH - 8);
      }

      // Rank
      const rankLabel = String(idx + 1);
      ctx.font = `bold 22px sans-serif`;
      ctx.fillStyle = idx === 0 ? "#1DB954" : idx === 1 ? "#aaaaaa" : idx === 2 ? "#cd7f32" : "#333333";
      ctx.fillText(rankLabel, 44, y + rowH / 2 + 8);

      // Player name
      ctx.font = `${isWinner ? "700" : "500"} 18px sans-serif`;
      ctx.fillStyle = isWinner ? "#ffffff" : "#cccccc";
      const maxNameW = 360;
      let nameText = p.name;
      while (ctx.measureText(nameText).width > maxNameW && nameText.length > 1) {
        nameText = nameText.slice(0, -1);
      }
      if (nameText !== p.name) nameText += "…";
      ctx.fillText(nameText, 90, y + rowH / 2 + 8);

      // Score
      ctx.font = `bold 28px sans-serif`;
      ctx.fillStyle = isWinner ? "#1DB954" : "#555555";
      const scoreStr = String(p.score);
      const scoreW = ctx.measureText(scoreStr).width;
      ctx.fillText(scoreStr, W - 44 - scoreW, y + rowH / 2 + 10);

      // pts label
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#444";
      ctx.fillText("pts", W - 40, y + rowH / 2 + 10);
    });

    const footerY = headerH + sortedPlayers.length * rowH + 20;
    drawCardFooter(ctx, W, footerY);
    const outcome = await shareOrDownloadCanvas(
      canvas,
      `guesssong-results-${Date.now()}.png`,
      "GuessSong results"
    );
    trackEvent("result_shared", {
      card_type: "scores",
      outcome,
      playlist_source: playlistSource,
    });
  }

  /** Mixed Playlist Mode (v2): the group taste card — shared bangers + awards. */
  async function downloadTasteCard() {
    const tasteCard = buildTasteCard(tracks, roundHistory);
    const W = 640;
    const sharedTracks = tasteCard.sharedTracks.slice(0, 5);
    const sharedRowH = 44;
    const headerH = 200;
    const sharedSectionH =
      sharedTracks.length > 0 ? 40 + sharedTracks.length * sharedRowH + 20 : 0;
    const awardCount = (tasteCard.mostObscure ? 1 : 0) + (tasteCard.mostMainstream ? 1 : 0);
    const awardsSectionH = 40 + awardCount * 70 + 20;
    const footerH = 80;
    const H = headerH + sharedSectionH + awardsSectionH + footerH;
    const { canvas, ctx } = createResultCanvas(W, H);

    drawCardBackground(ctx, W, H);
    drawCardHeader(ctx, {
      width: W,
      kicker: "GUESS SONG",
      title: "Taste Card",
      subtitle: playlistName,
    });

    let y = headerH;

    if (sharedTracks.length > 0) {
      ctx.fillStyle = "#1DB954";
      ctx.font = "bold 13px sans-serif";
      ctx.letterSpacing = "1px";
      ctx.fillText("SHARED BANGERS", 40, y + 24);
      y += 40;

      sharedTracks.forEach((t) => {
        ctx.font = "600 16px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.letterSpacing = "0px";
        let nameText = t.name;
        const maxNameW = W - 80;
        while (ctx.measureText(nameText).width > maxNameW && nameText.length > 1) {
          nameText = nameText.slice(0, -1);
        }
        if (nameText !== t.name) nameText += "…";
        ctx.fillText(nameText, 40, y + 20);

        ctx.font = "13px sans-serif";
        ctx.fillStyle = "#666666";
        ctx.fillText(t.contributors.join(" & "), 40, y + 38);

        y += sharedRowH;
      });
      y += 20;
    }

    ctx.fillStyle = "#1DB954";
    ctx.font = "bold 13px sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillText("AWARDS", 40, y + 24);
    y += 40;

    if (tasteCard.mostObscure) {
      ctx.font = "13px sans-serif";
      ctx.fillStyle = "#666666";
      ctx.letterSpacing = "0px";
      ctx.fillText("MOST OBSCURE TASTE", 40, y + 16);
      ctx.font = "700 24px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(
        `${tasteCard.mostObscure.playerName} — ${Math.round(tasteCard.mostObscure.rate * 100)}% guessed`,
        40,
        y + 46
      );
      y += 70;
    }

    if (tasteCard.mostMainstream) {
      ctx.font = "13px sans-serif";
      ctx.fillStyle = "#666666";
      ctx.fillText("MOST MAINSTREAM", 40, y + 16);
      ctx.font = "700 24px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(
        `${tasteCard.mostMainstream.playerName} — ${Math.round(tasteCard.mostMainstream.averagePopularity)} popularity`,
        40,
        y + 46
      );
      y += 70;
    }

    drawCardFooter(ctx, W, y + 20);
    const outcome = await shareOrDownloadCanvas(
      canvas,
      `guesssong-taste-card-${Date.now()}.png`,
      "GuessSong taste card"
    );
    trackEvent("result_shared", {
      card_type: "taste",
      outcome,
      playlist_source: playlistSource,
    });
  }

  const currentTrack = tracks[currentIndex];
  const albumArt = currentTrack?.albumImageUrl || ALBUM_PLACEHOLDER;
  const isRevealed = phase === "revealed" || phase === "finished";
  const showAlbumArt = isRevealed || albumHintShown;
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const maxScore = sortedPlayers[0]?.score ?? 0;

  if (tracks.length === 0) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "#555", fontFamily: "Outfit, sans-serif" }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { overflow: hidden; max-width: 100vw; }
        body { background: #111; color: #f0f0f0; font-family: 'Outfit', sans-serif; }

        .game-layout {
          display: grid;
          grid-template-rows: 56px 1fr;
          grid-template-columns: 1fr 300px;
          height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #111;
        }
        /* Trial mode: no sidebar, main area takes the full width */
        .game-layout.trial { grid-template-columns: 1fr; }

        .top-bar {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          background: rgba(17,17,17,0.95);
          border-bottom: 1px solid #222;
          backdrop-filter: blur(8px);
        }

        .round-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #666;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .round-num {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          color: #1DB954;
          letter-spacing: 0.05em;
        }

        .playlist-name {
          font-size: 13px;
          color: #555;
          font-weight: 400;
          max-width: 300px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* MAIN AREA */
        .main-area {
          position: relative;
          overflow-y: auto;
          overflow-x: hidden;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 32px;
        }

        /* Ambient background */
        .ambient-bg {
          position: absolute;
          inset: -20px;
          background-size: cover;
          background-position: center;
          filter: blur(60px) saturate(0.6);
          opacity: 0.25;
          transition: opacity 0.8s ease;
          z-index: 0;
        }
        .ambient-bg.revealed { opacity: 0.4; filter: blur(40px) saturate(0.8); }

        /* Content card */
        .game-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 540px;
          background: rgba(20,20,20,0.92);
          border: 1px solid #2a2a2a;
          border-radius: 20px;
          padding: 28px;
          backdrop-filter: blur(20px);
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }

        /* Album art */
        .album-wrap {
          width: 100%;
          aspect-ratio: 1;
          border-radius: 12px;
          overflow: hidden;
          position: relative;
          background: #1a1a1a;
          margin-bottom: 20px;
        }
        .album-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: filter 0.7s ease, transform 0.7s ease;
        }
        .album-img.blurred { filter: blur(18px) brightness(0.4) saturate(0.4); transform: scale(1.08); }
        .album-img.revealed { filter: blur(0) brightness(1) saturate(1); transform: scale(1); }
        .album-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 0.4s;
        }

        /* Play button */
        .play-btn {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: #1DB954;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 40px rgba(29,185,84,0.5);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .play-btn:hover { transform: scale(1.06); box-shadow: 0 0 56px rgba(29,185,84,0.7); }
        .play-btn:active { transform: scale(0.97); }
        .play-icon { width: 0; height: 0; border-style: solid; border-width: 14px 0 14px 24px; border-color: transparent transparent transparent #000; margin-left: 4px; }

        /* Progress bar */
        .progress-wrap {
          height: 4px;
          background: #222;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 20px;
        }
        .progress-fill {
          height: 100%;
          background: #1DB954;
          border-radius: 2px;
          transition: width 0.1s linear;
          box-shadow: 0 0 8px rgba(29,185,84,0.6);
        }

        /* Listening pulse */
        .listening-label {
          text-align: center;
          font-size: 14px;
          color: #1DB954;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          animation: pulse-opacity 1.2s ease-in-out infinite;
        }
        @keyframes pulse-opacity { 0%,100%{opacity:1} 50%{opacity:0.4} }

        /* Guess input */
        .guess-input {
          width: 100%;
          background: #1e1e1e;
          border: 1.5px solid #2a2a2a;
          border-radius: 10px;
          padding: 14px 16px;
          font-size: 16px;
          font-family: 'Outfit', sans-serif;
          color: #f0f0f0;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          margin-bottom: 10px;
        }
        .guess-input:focus { border-color: #1DB954; box-shadow: 0 0 0 3px rgba(29,185,84,0.12); }
        .guess-input::placeholder { color: #444; }
        .guess-input.shake { animation: shake 0.4s ease; border-color: #ef4444; }
        @keyframes shake {
          0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}
        }

        .btn-row { display: flex; gap: 8px; }

        .btn-primary {
          flex: 1;
          padding: 12px;
          background: #1DB954;
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 15px;
          font-weight: 700;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        .btn-primary:hover { background: #1ed760; transform: translateY(-1px); }
        .btn-primary:active { transform: translateY(0); }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

        .btn-ghost {
          padding: 12px 16px;
          background: transparent;
          color: #666;
          font-family: 'Outfit', sans-serif;
          font-size: 14px;
          font-weight: 500;
          border: 1.5px solid #2a2a2a;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .btn-ghost:hover { border-color: #444; color: #999; }

        /* Revealed state */
        .track-reveal { text-align: center; padding: 4px 0 16px; }
        .track-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(28px, 5vw, 48px);
          letter-spacing: 0.03em;
          color: #fff;
          line-height: 1;
          margin-bottom: 6px;
        }
        .track-artist {
          font-size: 15px;
          color: #888;
          font-weight: 400;
        }

        .correct-label {
          text-align: center;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 36px;
          color: #1DB954;
          letter-spacing: 0.06em;
          margin-bottom: 12px;
          text-shadow: 0 0 24px rgba(29,185,84,0.5);
          animation: pop-in 0.3s cubic-bezier(0.175,0.885,0.32,1.275);
        }
        @keyframes pop-in { from{transform:scale(0.6);opacity:0} to{transform:scale(1);opacity:1} }

        .who-scored {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #555;
          margin-bottom: 10px;
          text-align: center;
        }

        .player-picker { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 14px; }
        .player-pick-btn {
          padding: 9px 18px;
          border-radius: 999px;
          font-family: 'Outfit', sans-serif;
          font-size: 14px;
          font-weight: 600;
          border: 1.5px solid #2a2a2a;
          background: #1a1a1a;
          color: #ccc;
          cursor: pointer;
          transition: all 0.15s;
        }
        .player-pick-btn:hover { border-color: #1DB954; color: #1DB954; background: rgba(29,185,84,0.08); }
        .player-pick-btn.picked { background: #1DB954; border-color: #1DB954; color: #000; }
        .player-pick-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .no-score-label { text-align: center; color: #555; font-size: 14px; margin-bottom: 14px; padding: 10px; }

        /* SIDEBAR */
        .sidebar {
          border-left: 1px solid #1e1e1e;
          background: #0e0e0e;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .sidebar-header {
          padding: 16px 20px 12px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #444;
          border-bottom: 1px solid #1a1a1a;
        }

        .score-list { flex: 1; overflow-y: auto; padding: 8px 0; }
        .score-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 20px;
          transition: background 0.15s;
          gap: 12px;
        }
        .score-row.leader { background: rgba(29,185,84,0.05); }
        .score-row-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .rank-num { font-size: 11px; color: #333; font-weight: 600; width: 16px; text-align: center; flex-shrink: 0; }
        .rank-num.first { color: #1DB954; }
        .player-name-score {
          font-size: 14px;
          font-weight: 500;
          color: #ccc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .player-name-score.leader { color: #fff; }
        .score-chip {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 20px;
          color: #555;
          letter-spacing: 0.04em;
          transition: color 0.3s;
          flex-shrink: 0;
        }
        .score-chip.leader { color: #1DB954; }
        .score-chip.pulse { animation: score-pop 0.5s cubic-bezier(0.175,0.885,0.32,1.275); }
        @keyframes score-pop { 0%{transform:scale(1)} 50%{transform:scale(1.5);color:#1DB954} 100%{transform:scale(1)} }

        /* FINISHED STATE */
        .finished-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(10,10,10,0.97);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding: 28px 24px 24px;
          animation: fade-in 0.4s ease;
          overflow: hidden;
        }
        @keyframes fade-in { from{opacity:0} to{opacity:1} }

        .finished-header {
          flex-shrink: 0;
          text-align: center;
          width: 100%;
          max-width: 480px;
        }

        .finished-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(36px, 6vw, 72px);
          letter-spacing: 0.04em;
          background: linear-gradient(135deg, #fff 0%, #aaffc8 50%, #1DB954 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
          margin-bottom: 4px;
          text-align: center;
        }

        /* Winner hero card — shown above the list */
        .winner-hero {
          flex-shrink: 0;
          width: 100%;
          max-width: 480px;
          background: linear-gradient(135deg, rgba(29,185,84,0.15) 0%, rgba(29,185,84,0.05) 100%);
          border: 1px solid rgba(29,185,84,0.35);
          border-radius: 14px;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
          margin: 12px 0 8px;
        }
        .winner-trophy { font-size: 28px; line-height: 1; flex-shrink: 0; }
        .winner-hero-name {
          flex: 1;
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(22px, 4vw, 32px);
          letter-spacing: 0.04em;
          color: #1DB954;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .winner-hero-score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 36px;
          color: #1DB954;
          letter-spacing: 0.03em;
          text-shadow: 0 0 20px rgba(29,185,84,0.5);
          flex-shrink: 0;
        }
        .winner-hero-pts {
          font-size: 11px;
          color: #1DB954;
          opacity: 0.6;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-top: 2px;
          flex-shrink: 0;
        }

        .final-scoreboard {
          width: 100%;
          max-width: 480px;
          background: #161616;
          border: 1px solid #222;
          border-radius: 14px;
          overflow-y: auto;
          overflow-x: hidden;
          flex: 1 1 0;
          min-height: 0;
          margin-bottom: 16px;
        }
        /* subtle scrollbar */
        .final-scoreboard::-webkit-scrollbar { width: 4px; }
        .final-scoreboard::-webkit-scrollbar-track { background: transparent; }
        .final-scoreboard::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }

        .final-row {
          display: flex;
          align-items: center;
          padding: 9px 20px;
          gap: 12px;
          border-bottom: 1px solid #1e1e1e;
          transition: background 0.2s;
          min-height: 44px;
        }
        .final-row:last-child { border-bottom: none; }

        .final-rank {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          width: 24px;
          text-align: center;
          flex-shrink: 0;
          line-height: 1;
        }
        .final-rank.first { color: #1DB954; }
        .final-rank.second { color: #aaa; }
        .final-rank.third { color: #cd7f32; }
        .final-rank.rest { color: #333; }

        .final-name {
          flex: 1;
          font-size: 15px;
          font-weight: 500;
          color: #ccc;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .final-score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          color: #444;
          letter-spacing: 0.03em;
          flex-shrink: 0;
        }
        .final-score.podium { color: #888; }

        .finished-btn-row {
          display: flex;
          gap: 12px;
          flex-shrink: 0;
          width: 100%;
          max-width: 480px;
        }
        .btn-lg {
          flex: 1;
          padding: 13px 24px;
          font-family: 'Outfit', sans-serif;
          font-size: 15px;
          font-weight: 700;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.15s;
          border: none;
          white-space: nowrap;
        }
        .btn-lg.green { background: #1DB954; color: #000; box-shadow: 0 4px 24px rgba(29,185,84,0.3); }
        .btn-lg.green:hover { background: #1ed760; transform: translateY(-1px); box-shadow: 0 4px 32px rgba(29,185,84,0.5); }
        .btn-lg.outline { background: transparent; color: #666; border: 1.5px solid #2a2a2a; }
        .btn-lg.outline:hover { color: #999; border-color: #444; }

        .install-cta {
          width: 100%;
          max-width: 480px;
          display: flex;
          align-items: center;
          gap: 14px;
          background: rgba(29,185,84,0.06);
          border: 1px solid rgba(29,185,84,0.25);
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 16px;
          flex-shrink: 0;
          text-align: left;
        }
        .install-cta-emoji { font-size: 24px; flex-shrink: 0; }
        .install-cta-title { font-size: 14px; font-weight: 600; color: #f0f0f0; line-height: 1.3; }
        .install-cta-desc { font-size: 12px; color: #888; margin-top: 3px; line-height: 1.4; }
        .install-cta-btn {
          margin-left: auto;
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
        .install-cta-btn:hover { background: #1ed760; transform: translateY(-1px); }

        @media (max-width: 768px) {
          .game-layout {
            grid-template-columns: 1fr;
            grid-template-rows: 56px 1fr auto;
          }
          .sidebar { border-left: none; border-top: 1px solid #1e1e1e; max-height: 140px; }
          .end-game-btn { font-size: 10px !important; padding: 4px 8px !important; }
        }
      `}</style>

      <audio ref={audioRef} />

      <div className={`game-layout${isTrial ? " trial" : ""}`}>
        {/* TOP BAR */}
        <header className="top-bar">
          <div className="round-badge">
            <span>Round</span>
            <span className="round-num">
              {phase === "finished" ? tracks.length : currentIndex + 1}
            </span>
            <span style={{ color: "#333" }}>/</span>
            <span>{tracks.length}</span>
          </div>
          <span className="playlist-name">{playlistName}</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {isTrial && (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#1DB954",
                  letterSpacing: "0.06em",
                  whiteSpace: "nowrap",
                }}
              >
                Correct: {players[0]?.score ?? 0}
              </span>
            )}
            {phase !== "finished" && (
              <button
                className="end-game-btn"
                onClick={endGame}
                style={{
                  background: "none",
                  border: "1px solid #2a2a2a",
                  borderRadius: "8px",
                  color: "#888",
                  fontSize: "12px",
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 600,
                  padding: "6px 12px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#1DB954"; e.currentTarget.style.borderColor = "#1DB954"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#2a2a2a"; }}
              >
                End Game
              </button>
            )}
            <button
              onClick={() => { stopClip(); router.push("/"); }}
              style={{
                background: "none",
                border: "1px solid #2a2a2a",
                borderRadius: "8px",
                color: "#555",
                fontSize: "12px",
                fontFamily: "Outfit, sans-serif",
                fontWeight: 500,
                padding: "6px 12px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#ef4444"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#555"; e.currentTarget.style.borderColor = "#2a2a2a"; }}
            >
              Quit
            </button>
          </div>
        </header>

        {/* MAIN AREA */}
        <main className="main-area">
          {/* Ambient background — only when hint shown or revealed */}
          {currentTrack?.albumImageUrl && showAlbumArt && (
            <div
              className={`ambient-bg${isRevealed ? " revealed" : ""}`}
              style={{ backgroundImage: `url(${albumArt})` }}
            />
          )}

          {/* Game card */}
          <div className="game-card">
            {/* Album art */}
            <div className="album-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={showAlbumArt ? albumArt : ALBUM_PLACEHOLDER}
                alt="Album art"
                className={`album-img${isRevealed ? " revealed" : showAlbumArt ? " blurred" : " blurred"}`}
              />
              {/* Play button overlay */}
              {phase === "waiting" && !noAudio && (
                <div className="album-overlay">
                  <button className="play-btn" onClick={playClip} aria-label="Play clip" disabled={previewLoading} style={previewLoading ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
                    {previewLoading ? (
                      <div style={{ width: "24px", height: "24px", border: "3px solid rgba(0,0,0,0.3)", borderTop: "3px solid #000", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                    ) : (
                      <div className="play-icon" />
                    )}
                  </button>
                </div>
              )}
              {/* No audio overlay */}
              {phase === "waiting" && noAudio && (
                <div className="album-overlay" style={{ background: "rgba(0,0,0,0.75)", flexDirection: "column", gap: "8px" }}>
                  <p style={{ color: "#999", fontSize: "13px", textAlign: "center", padding: "0 16px" }}>No audio for this track</p>
                </div>
              )}
              {phase === "playing" && (
                <div className="album-overlay" style={{ background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginBottom: "12px" }}>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          style={{
                            width: "4px",
                            borderRadius: "2px",
                            background: "#1DB954",
                            animation: `eq-bar 0.8s ease-in-out infinite alternate`,
                            animationDelay: `${i * 0.12}s`,
                            height: "24px",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {(phase === "playing" || phase === "guessing") && (
              <div className="progress-wrap">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Phase content */}
            {phase === "waiting" && (
              <div style={{ textAlign: "center" }}>
                {previewLoading ? (
                  <div>
                    <p style={{ color: "#1DB954", fontSize: "13px", letterSpacing: "0.06em", marginBottom: "12px" }}>
                      Finding audio…
                    </p>
                    {loadingSkipVisible && (
                      <div className="btn-row">
                        <button className="btn-primary" onClick={reveal}>
                          Reveal Answer →
                        </button>
                        <button className="btn-ghost" onClick={nextTrack}>
                          Skip Track
                        </button>
                      </div>
                    )}
                  </div>
                ) : noAudio ? (
                  <div>
                    <div className="btn-row">
                      <button className="btn-primary" onClick={reveal}>
                        Reveal Answer →
                      </button>
                      <button className="btn-ghost" onClick={nextTrack}>
                        Skip Track
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "#555", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Press Play to start the clip
                  </p>
                )}
              </div>
            )}

            {phase === "playing" && (
              <div>
                <p className="listening-label" style={{ marginBottom: "12px" }}>Listening…</p>
                <div className="btn-row" style={{ marginBottom: "8px" }}>
                  <button className="btn-ghost" style={{ flex: "0 0 auto" }} onClick={() => { stopClip(); setProgress(100); setPhase("guessing"); }}>
                    Stop
                  </button>
                  <button className="btn-primary" onClick={reveal}>
                    Reveal Answer →
                  </button>
                  {isTrial && (
                    <button className="btn-ghost" style={{ flex: "0 0 auto" }} onClick={nextTrack}>
                      Skip →
                    </button>
                  )}
                </div>
                <button
                  className="btn-ghost"
                  style={{ width: "100%", ...(albumHintShown ? { color: "#1DB954", borderColor: "#1DB954", opacity: 0.7 } : {}) }}
                  onClick={() => setAlbumHintShown(true)}
                  disabled={albumHintShown}
                >
                  {albumHintShown ? "Album Art Shown" : "Show Album Art Hint"}
                </button>
              </div>
            )}

            {phase === "guessing" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{ textAlign: "center", fontSize: "20px", fontWeight: 600, color: "#f0f0f0", marginBottom: "4px" }}>
                  What&apos;s the song?
                </p>
                <div className="btn-row">
                  <button
                    className="btn-ghost"
                    style={{ flex: "0 0 auto" }}
                    onClick={() => {
                      const audio = audioRef.current;
                      if (audio && audio.src) {
                        audio.currentTime = 0;
                        audio.play().catch(() => {});
                      }
                    }}
                  >
                    Replay
                  </button>
                  <button className="btn-primary" onClick={reveal}>
                    Reveal Answer →
                  </button>
                  {isTrial && (
                    <button className="btn-ghost" style={{ flex: "0 0 auto" }} onClick={nextTrack}>
                      Skip →
                    </button>
                  )}
                </div>
                {!albumHintShown && currentTrack?.albumImageUrl && (
                  <button className="btn-ghost" onClick={() => setAlbumHintShown(true)}>
                    Show Album Art Hint
                  </button>
                )}
              </div>
            )}

            {phase === "revealed" && (
              <div>
                <div className="track-reveal">
                  <p className="track-name">{currentTrack?.name}</p>
                  <p className="track-artist">{currentTrack?.artists.join(", ")}</p>
                  {currentTrack?.albumName && (
                    <p style={{ fontSize: "13px", color: "#666", marginTop: "6px" }}>
                      {currentTrack.albumName}
                    </p>
                  )}
                  {currentTrack?.contributors && currentTrack.contributors.length > 0 && (
                    <p style={{ fontSize: "13px", color: "#1DB954", marginTop: "8px", fontWeight: 500 }}>
                      {currentTrack.contributors.length > 1
                        ? `From ${currentTrack.contributors.join(" & ")}'s playlists!`
                        : `From ${currentTrack.contributors[0]}'s playlist`}
                    </p>
                  )}
                </div>

                {isTrial ? (
                  <>
                    {/* Trial mode: self-scored, no player picker */}
                    {pointsAwarded ? (
                      <p style={{ textAlign: "center", color: "#1DB954", fontSize: "13px", marginBottom: "14px" }}>
                        +1 — nice ear!
                      </p>
                    ) : (
                      <div className="player-picker" style={{ marginBottom: "14px" }}>
                        <button className="player-pick-btn" onClick={markTrialCorrect}>
                          I got it ✓
                        </button>
                      </div>
                    )}
                    <button
                      className="btn-primary"
                      onClick={nextTrack}
                      style={{ flex: "none", display: "block", margin: "0 auto", minWidth: "180px", width: "fit-content" }}
                    >
                      {currentIndex + 1 >= tracks.length ? "See Results →" : "Next →"}
                    </button>
                  </>
                ) : (
                  <>
                {/* Song scoring — 3 pts */}
                <p className="who-scored">Who guessed the song? (+3 pts)</p>
                {!pointsAwarded ? (
                  <div className="player-picker" style={{ marginBottom: "14px" }}>
                    {players.map((p) => (
                      <button key={p.name} className="player-pick-btn" onClick={() => awardPoint(p.name)}>
                        {p.name}
                      </button>
                    ))}
                    <button className="btn-ghost" onClick={() => setPointsAwarded(true)}>
                      No one
                    </button>
                  </div>
                ) : (
                  <p style={{ textAlign: "center", color: "#1DB954", fontSize: "13px", marginBottom: "14px" }}>
                    {roundWinner ? `+3 pts → ${roundWinner}` : "No one scored"}
                  </p>
                )}

                {/* Album scoring — 1 pt, only if track has album */}
                {currentTrack?.albumName && (
                  <>
                    <p className="who-scored">Who guessed the album? (+1 pt)</p>
                    {!albumPointsAwarded ? (
                      <div className="player-picker" style={{ marginBottom: "14px" }}>
                        {players.map((p) => (
                          <button key={p.name} className="player-pick-btn" onClick={() => awardAlbumPoint(p.name)}>
                            {p.name}
                          </button>
                        ))}
                        <button className="btn-ghost" onClick={() => setAlbumPointsAwarded(true)}>
                          No one
                        </button>
                      </div>
                    ) : (
                      <p style={{ textAlign: "center", color: "#1DB954", fontSize: "13px", marginBottom: "14px" }}>
                        {albumWinner ? `+1 pt → ${albumWinner}` : "No one scored"}
                      </p>
                    )}
                  </>
                )}

                {/* Source scoring — 2 pts, Mixed Playlist Mode only. Every player is */}
                {/* eligible, including this track's contributor(s) — sampling means a */}
                {/* contributor doesn't know which of their tracks made the pool, so they */}
                {/* may not recognize their own track any faster than anyone else. */}
                {currentTrack?.contributors && currentTrack.contributors.length > 0 && (
                  <>
                    <p className="who-scored">Who guessed whose playlist this is? (+2 pts)</p>
                    {!sourcePointsAwarded ? (
                      <div className="player-picker" style={{ marginBottom: "14px" }}>
                        {players.map((p) => (
                          <button
                            key={p.name}
                            className="player-pick-btn"
                            onClick={() => awardSourcePoint(p.name)}
                          >
                            {p.name}
                          </button>
                        ))}
                        <button className="btn-ghost" onClick={() => setSourcePointsAwarded(true)}>
                          No one
                        </button>
                      </div>
                    ) : (
                      <p style={{ textAlign: "center", color: "#1DB954", fontSize: "13px", marginBottom: "14px" }}>
                        {sourceWinner ? `+2 pts → ${sourceWinner}` : "No one scored"}
                      </p>
                    )}
                  </>
                )}

                <button className="btn-primary" onClick={nextTrack} style={{ flex: "none", display: "block", margin: "0 auto", minWidth: "180px", width: "fit-content" }}>
                  {currentIndex + 1 >= tracks.length ? "See Final Scores →" : "Next Track →"}
                </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Finished overlay — trial mode: simple result + party CTA */}
          {phase === "finished" && isTrial && (
            <div className="finished-overlay" style={{ justifyContent: "center" }}>
              <div className="finished-header">
                <p style={{ fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#555", marginBottom: "4px" }}>
                  Trial Complete
                </p>
                <h1 className="finished-title">
                  You got {players[0]?.score ?? 0} / {roundsPlayedRef.current}
                </h1>
                <p style={{ color: "#444", fontSize: "13px" }}>{playlistName}</p>
                <p style={{ color: "#888", fontSize: "14px", marginTop: "16px", lineHeight: 1.5 }}>
                  Next time, bring your friends — GuessSong is built for parties.
                </p>
              </div>
              {installCta && (
                <div style={{ marginTop: "28px", display: "flex", justifyContent: "center" }}>
                  <InstallCta onInstall={handleInstall} />
                </div>
              )}
              <div className="finished-btn-row" style={{ marginTop: installCta ? "0" : "28px" }}>
                <button className="btn-lg green" onClick={() => router.push("/")}>
                  Start a Party Game →
                </button>
                <button className="btn-lg outline" onClick={playAgain}>
                  Play Again
                </button>
              </div>
            </div>
          )}

          {/* Finished overlay (full screen inside main) */}
          {phase === "finished" && !isTrial && (
            <div className="finished-overlay">
              {/* Header */}
              <div className="finished-header">
                <p style={{ fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#555", marginBottom: "4px" }}>
                  Game Over
                </p>
                <h1 className="finished-title">Final Scores</h1>
                <p style={{ color: "#444", fontSize: "13px" }}>{playlistName}</p>
              </div>

              {/* Winner hero — only shown when someone scored */}
              {maxScore > 0 && sortedPlayers.length > 0 && (
                <div className="winner-hero">
                  <span className="winner-trophy">🏆</span>
                  <span className="winner-hero-name">{sortedPlayers[0].name}</span>
                  <div style={{ textAlign: "right" }}>
                    <div className="winner-hero-score">{sortedPlayers[0].score}</div>
                    <div className="winner-hero-pts">pts</div>
                  </div>
                </div>
              )}

              {/* Rest of players (2nd place onward) in compact scrollable list */}
              {sortedPlayers.length > 1 && (
                <div className="final-scoreboard">
                  {sortedPlayers.slice(1).map((p, i) => {
                    const idx = i + 1; // actual rank index (0-based = 2nd place onward)
                    const rankClass = idx === 1 ? "second" : idx === 2 ? "third" : "rest";
                    const rankLabel = `${idx + 1}`;
                    const isPodium = idx <= 2;
                    return (
                      <div key={p.name} className="final-row">
                        <span className={`final-rank ${rankClass}`}>{rankLabel}</span>
                        <span className="final-name">{p.name}</span>
                        <span className={`final-score${isPodium ? " podium" : ""}`}>{p.score}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {installCta && <InstallCta onInstall={handleInstall} />}

              {/* Buttons — always visible, pinned at bottom */}
              <div className="finished-btn-row">
                <button className="btn-lg green" onClick={playAgain}>
                  Play Again →
                </button>
                <button className="btn-lg outline" onClick={downloadResultImage}>
                  Save Results
                </button>
                {playlistSource === "mixed" && (
                  <button className="btn-lg outline" onClick={downloadTasteCard}>
                    Save Taste Card
                  </button>
                )}
              </div>
            </div>
          )}
        </main>

        {/* SIDEBAR SCOREBOARD — hidden in trial mode */}
        {!isTrial && (
        <aside className="sidebar">
          <div className="sidebar-header">Scoreboard</div>
          <div className="score-list">
            {sortedPlayers.map((p, idx) => {
              const isLeader = p.score === maxScore && maxScore > 0;
              return (
                <div key={p.name} className={`score-row${isLeader ? " leader" : ""}`}>
                  <div className="score-row-left">
                    <span className={`rank-num${idx === 0 ? " first" : ""}`}>{idx + 1}</span>
                    <span className={`player-name-score${isLeader ? " leader" : ""}`}>{p.name}</span>
                  </div>
                  <span className={`score-chip${isLeader ? " leader" : ""}${scorePulse === p.name ? " pulse" : ""}`}>
                    {p.score}
                  </span>
                </div>
              );
            })}
          </div>
        </aside>
        )}
      </div>

      <style>{`
        @keyframes eq-bar {
          from { height: 8px; opacity: 0.5; }
          to { height: 32px; opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
