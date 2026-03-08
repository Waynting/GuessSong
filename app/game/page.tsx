"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { isAnswerCorrect } from "@/lib/game-logic";

interface Track {
  id: string;
  name: string;
  artists: string[];
  durationMs: number;
  albumName?: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  createdAt: string;
}

interface Player {
  name: string;
  score: number;
}

type Phase = "waiting" | "playing" | "guessing" | "revealed" | "finished";

const ALBUM_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%231a1a1a'/%3E%3Ccircle cx='200' cy='200' r='80' fill='%23222'/%3E%3Ccircle cx='200' cy='200' r='20' fill='%23111'/%3E%3C/svg%3E";

export default function GamePage() {
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [clipDuration, setClipDuration] = useState(15);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [guess, setGuess] = useState("");
  const [guessResult, setGuessResult] = useState<null | "correct" | "wrong">(null);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [shakeGuess, setShakeGuess] = useState(false);
  const [scorePulse, setScorePulse] = useState<string | null>(null);
  const [pointsAwarded, setPointsAwarded] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guessInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("guesssong_game");
    if (!raw) { router.push("/"); return; }
    try {
      const data = JSON.parse(raw);
      setTracks(data.tracks || []);
      setPlayers(data.players || []);
      setPlaylistName(data.playlistName || "");
      setClipDuration(data.clipDuration || 15);
    } catch {
      router.push("/");
    }
  }, [router]);

  const stopClip = useCallback(() => {
    audioRef.current?.pause();
    if (clipTimeoutRef.current) clearTimeout(clipTimeoutRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, []);

  function playClip() {
    const audio = audioRef.current;
    const track = tracks[currentIndex];
    if (!audio || !track?.previewUrl) return;

    audio.src = track.previewUrl;
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
      setTimeout(() => guessInputRef.current?.focus(), 100);
    }, clipDuration * 1000);
  }

  function checkAnswer() {
    const track = tracks[currentIndex];
    if (!track || !guess.trim()) return;

    const correct = isAnswerCorrect(guess, track.name, track.artists);
    setGuessResult(correct ? "correct" : "wrong");
    if (correct) {
      stopClip();
      setPhase("revealed");
    } else {
      setShakeGuess(true);
      setTimeout(() => setShakeGuess(false), 500);
    }
  }

  function giveUp() {
    stopClip();
    setGuessResult(null);
    setRoundWinner(null);
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

  function nextTrack() {
    stopClip();
    if (currentIndex + 1 >= tracks.length) {
      setPhase("finished");
    } else {
      setCurrentIndex((i) => i + 1);
      setPhase("waiting");
      setGuess("");
      setGuessResult(null);
      setRoundWinner(null);
      setProgress(0);
      setPointsAwarded(false);
    }
  }

  function playAgain() {
    router.push("/");
  }

  const currentTrack = tracks[currentIndex];
  const albumArt = currentTrack?.albumImageUrl || ALBUM_PLACEHOLDER;
  const isRevealed = phase === "revealed" || phase === "finished";
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
        body { background: #111; color: #f0f0f0; font-family: 'Outfit', sans-serif; overflow: hidden; }

        .game-layout {
          display: grid;
          grid-template-rows: 56px 1fr;
          grid-template-columns: 1fr 300px;
          height: 100vh;
          background: #111;
        }

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
          overflow: hidden;
          display: flex;
          align-items: center;
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
          position: absolute;
          inset: 0;
          z-index: 10;
          background: rgba(10,10,10,0.97);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          animation: fade-in 0.4s ease;
        }
        @keyframes fade-in { from{opacity:0} to{opacity:1} }

        .finished-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(48px, 8vw, 96px);
          letter-spacing: 0.04em;
          background: linear-gradient(135deg, #fff 0%, #aaffc8 50%, #1DB954 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
          margin-bottom: 8px;
          text-align: center;
        }

        .final-scoreboard {
          width: 100%;
          max-width: 440px;
          background: #161616;
          border: 1px solid #222;
          border-radius: 16px;
          overflow: hidden;
          margin: 24px 0;
        }

        .final-row {
          display: flex;
          align-items: center;
          padding: 14px 24px;
          gap: 16px;
          border-bottom: 1px solid #1e1e1e;
          transition: background 0.2s;
        }
        .final-row:last-child { border-bottom: none; }
        .final-row.winner { background: rgba(29,185,84,0.08); }

        .final-rank {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px;
          width: 32px;
          text-align: center;
          flex-shrink: 0;
        }
        .final-rank.first { color: #1DB954; }
        .final-rank.second { color: #aaa; }
        .final-rank.third { color: #cd7f32; }
        .final-rank.rest { color: #333; }

        .final-name {
          flex: 1;
          font-size: 18px;
          font-weight: 600;
          color: #f0f0f0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .final-name.winner { color: #fff; }
        .winner-star { color: #1DB954; margin-left: 8px; }

        .final-score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 32px;
          color: #555;
          letter-spacing: 0.03em;
        }
        .final-score.winner { color: #1DB954; text-shadow: 0 0 20px rgba(29,185,84,0.4); }

        .finished-btn-row { display: flex; gap: 12px; }
        .btn-lg {
          padding: 14px 32px;
          font-family: 'Outfit', sans-serif;
          font-size: 16px;
          font-weight: 700;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.15s;
          border: none;
        }
        .btn-lg.green { background: #1DB954; color: #000; box-shadow: 0 4px 24px rgba(29,185,84,0.3); }
        .btn-lg.green:hover { background: #1ed760; transform: translateY(-1px); box-shadow: 0 4px 32px rgba(29,185,84,0.5); }
        .btn-lg.outline { background: transparent; color: #666; border: 1.5px solid #2a2a2a; }
        .btn-lg.outline:hover { color: #999; border-color: #444; }

        @media (max-width: 768px) {
          .game-layout {
            grid-template-columns: 1fr;
            grid-template-rows: 56px 1fr auto;
          }
          .sidebar { border-left: none; border-top: 1px solid #1e1e1e; max-height: 160px; }
        }
      `}</style>

      <audio ref={audioRef} />

      <div className="game-layout">
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
          <span className="playlist-name">♫ {playlistName}</span>
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
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = "#ef4444"; (e.target as HTMLButtonElement).style.borderColor = "#ef4444"; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = "#555"; (e.target as HTMLButtonElement).style.borderColor = "#2a2a2a"; }}
          >
            ✕ Quit
          </button>
        </header>

        {/* MAIN AREA */}
        <main className="main-area">
          {/* Ambient background */}
          {currentTrack?.albumImageUrl && (
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
                src={albumArt}
                alt="Album art"
                className={`album-img${isRevealed ? " revealed" : " blurred"}`}
              />
              {/* Play button overlay */}
              {phase === "waiting" && (
                <div className="album-overlay">
                  <button className="play-btn" onClick={playClip} aria-label="Play clip">
                    <div className="play-icon" />
                  </button>
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
              <p style={{ textAlign: "center", color: "#555", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Press ▶ to play clip
              </p>
            )}

            {phase === "playing" && (
              <p className="listening-label">Listening…</p>
            )}

            {phase === "guessing" && (
              <div>
                <input
                  ref={guessInputRef}
                  type="text"
                  className={`guess-input${shakeGuess ? " shake" : ""}`}
                  placeholder="Type song name or artist…"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && checkAnswer()}
                  autoComplete="off"
                  spellCheck={false}
                />
                {guessResult === "wrong" && (
                  <p style={{ fontSize: "12px", color: "#ef4444", marginBottom: "8px", marginTop: "-4px" }}>
                    Not quite — try again!
                  </p>
                )}
                <div className="btn-row">
                  <button
                    className="btn-primary"
                    onClick={checkAnswer}
                    disabled={!guess.trim()}
                  >
                    Check Answer
                  </button>
                  <button className="btn-ghost" onClick={giveUp}>
                    Give Up
                  </button>
                </div>
              </div>
            )}

            {phase === "revealed" && (
              <div>
                {guessResult === "correct" && (
                  <p className="correct-label">✓ Correct!</p>
                )}
                <div className="track-reveal">
                  <p className="track-name">{currentTrack?.name}</p>
                  <p className="track-artist">{currentTrack?.artists.join(", ")}</p>
                  {currentTrack?.albumName && (
                    <p style={{ fontSize: "12px", color: "#444", marginTop: "4px" }}>{currentTrack.albumName}</p>
                  )}
                </div>

                {guessResult === "correct" && !pointsAwarded && (
                  <>
                    <p className="who-scored">Who scored?</p>
                    <div className="player-picker">
                      {players.map((p) => (
                        <button
                          key={p.name}
                          className={`player-pick-btn${roundWinner === p.name ? " picked" : ""}`}
                          onClick={() => awardPoint(p.name)}
                          disabled={pointsAwarded}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {guessResult === "correct" && pointsAwarded && roundWinner && (
                  <p style={{ textAlign: "center", color: "#1DB954", fontSize: "14px", marginBottom: "14px" }}>
                    +3 pts → {roundWinner}
                  </p>
                )}

                {guessResult !== "correct" && (
                  <div className="no-score-label">No one scored this round</div>
                )}

                <button className="btn-primary" onClick={nextTrack}>
                  {currentIndex + 1 >= tracks.length ? "See Final Scores →" : "Next Track →"}
                </button>
              </div>
            )}
          </div>

          {/* Finished overlay (full screen inside main) */}
          {phase === "finished" && (
            <div className="finished-overlay">
              <p style={{ fontSize: "12px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#555", marginBottom: "8px" }}>
                Game Over
              </p>
              <h1 className="finished-title">Final Scores</h1>
              <p style={{ color: "#555", fontSize: "14px", marginBottom: "0" }}>
                {playlistName}
              </p>

              <div className="final-scoreboard">
                {sortedPlayers.map((p, idx) => {
                  const isWinner = p.score === maxScore && maxScore > 0;
                  const rankClass = idx === 0 ? "first" : idx === 1 ? "second" : idx === 2 ? "third" : "rest";
                  const rankLabel = idx === 0 ? "★" : `${idx + 1}`;
                  return (
                    <div key={p.name} className={`final-row${isWinner && idx === 0 ? " winner" : ""}`}>
                      <span className={`final-rank ${rankClass}`}>{rankLabel}</span>
                      <span className={`final-name${isWinner && idx === 0 ? " winner" : ""}`}>
                        {p.name}
                        {isWinner && idx === 0 && <span className="winner-star"> ★</span>}
                      </span>
                      <span className={`final-score${isWinner && idx === 0 ? " winner" : ""}`}>
                        {p.score}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="finished-btn-row">
                <button className="btn-lg green" onClick={playAgain}>
                  Play Again →
                </button>
                <button className="btn-lg outline" onClick={() => router.push("/")}>
                  Back to Setup
                </button>
              </div>
            </div>
          )}
        </main>

        {/* SIDEBAR SCOREBOARD */}
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
      </div>

      <style>{`
        @keyframes eq-bar {
          from { height: 8px; opacity: 0.5; }
          to { height: 32px; opacity: 1; }
        }
      `}</style>
    </>
  );
}
