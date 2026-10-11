"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { trackEvent, type PlaylistSource } from "@/lib/analytics";
import {
  scoreboardName,
  type GamePlayer as Player,
  type MixedPlaylistMeta,
} from "@/lib/game-session";
import { gameScored, playerBand } from "@/lib/game-players";
import { loadGame } from "@/lib/game-storage";
import { useScreenWakeLock } from "@/lib/wake-lock";
import { LoopQr } from "@/components/loop-qr";
import { formatMixList } from "@/lib/mix-export";
import {
  CARD_FOOTER_HEIGHT,
  createResultCanvas,
  drawCardBackground,
  drawCardHeader,
  drawCardFooter,
  shareOrDownloadCanvas,
} from "@/lib/result-image";
import {
  reportGameEnd,
  reportGameLeft,
  reportGameOverTap,
  reportOrderRound,
} from "@/lib/loop-client";
import type { GameHostKind, GameScreen, SetupSource } from "@/lib/loop-stats";
import { getHostGameCount } from "@/lib/host-session";
import {
  MIXED_NEXT_GAME_LABEL,
  MIXED_SETUP_HREF,
  PHONE_MEDIA_QUERY,
  gameOverOnward,
  gameScreenFor,
  readGameScreen,
} from "@/lib/game-over";
import {
  claimFirstPage,
  gameFingerprint,
  gamePageStorage,
  hostKindOf,
} from "@/lib/game-beacons";
import {
  ORDER_EXACT_POINTS,
  ORDER_OLDEST_POINTS,
  buildOrderRounds,
  orderLeftoverLine,
  orderRoundsPlayed,
  orderVerdict,
  releaseYear,
  trueOrder,
  type OrderRound,
} from "@/lib/order-game";
import { displayTitle } from "@/lib/quiz";

/**
 * "Put them in order": four songs face up, the room argues about which came
 * first, the host reveals the years and awards the points.
 *
 * ## Why a page of its own, and not a branch of /game
 *
 * `app/game/page.tsx` is 2,700 lines built around one `<audio>` element: a
 * round token so a resolving clip cannot land on the next round, a request
 * ledger so a refused `play()` cannot look like sound, a repair path for
 * rotted URLs, and a prefetch that spends a batch of upstream lookups the
 * moment it has tracks. Every one of those is pinned by a test that reads
 * that file. This game has no clip, so none of it applies — and a branch
 * inside that page would have had to prove, on every render, that none of
 * it ran. A page that never imports `lib/preview-client.ts` proves it by
 * construction; `tests/order-page.test.ts` reads this file for the import.
 *
 * What it shares with /game is everything that is not about audio: the
 * stored payload (`lib/game-storage.ts`), the first-page claim and the host
 * kind (`lib/game-beacons.ts`), the layout rule for Game Over
 * (`lib/game-over.ts`), the beacons (`lib/loop-client.ts`) and the result
 * card (`lib/result-image.ts`). The rules of the game itself — which cards
 * make a round, the true order, the verdict — are `lib/order-game.ts`,
 * where the suite can reach them.
 *
 * ## Why the host is still the judge
 *
 * Nobody types anything. The room says an order out loud, the host reveals
 * the real one and taps whoever called it; a wrong card is argued about,
 * not graded. Pass-the-phone with drag-to-order would make every round a
 * minute of one person holding the screen, and the point of this mode is
 * that the whole room is looking at the same four cards.
 */

type Phase = "showing" | "revealed" | "finished";

const ALBUM_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231a1a1a'/%3E%3Ccircle cx='100' cy='100' r='40' fill='%23222'/%3E%3Ccircle cx='100' cy='100' r='10' fill='%23111'/%3E%3C/svg%3E";

export default function OrderPage() {
  const router = useRouter();
  const [rounds, setRounds] = useState<OrderRound[]>([]);
  /** Songs the deal could not use — no year, or a year every other card had. */
  const [leftover, setLeftover] = useState(0);
  /**
   * The payload's tracks as stored: what the mix list describes. `rounds`
   * is what gets played, and a song left out of the deal is still a song
   * somebody brought.
   */
  const [pool, setPool] = useState<Track[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistSource, setPlaylistSource] = useState<PlaylistSource>("own");
  const [mixedMeta, setMixedMeta] = useState<MixedPlaylistMeta | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("showing");
  /** Who called the whole order this round, or null; doubles as the awarded flag. */
  const [exactWinner, setExactWinner] = useState<string | null>(null);
  const [oldestWinner, setOldestWinner] = useState<string | null>(null);
  const [scorePulse, setScorePulse] = useState<string | null>(null);
  /** Null until an effect has asked — see gameScreenFor in lib/game-over.ts. */
  const [screen, setScreen] = useState<GameScreen | null>(null);
  const [mixCopied, setMixCopied] = useState(false);
  const [mixFallback, setMixFallback] = useState<string | null>(null);

  // Read by what outlives a render: the leave beacon, which fires from a
  // listener registered once.
  const phaseRef = useRef<Phase>("showing");
  phaseRef.current = phase;
  // Read by the leave beacon, which runs from `pagehide` and so off the render.
  const playersRef = useRef<Player[]>([]);
  playersRef.current = players;
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const roundCountRef = useRef(0);
  roundCountRef.current = rounds.length;
  /** Read on mount; "unknown" until then and whenever storage will not say. */
  const hostKindRef = useRef<GameHostKind>("unknown");
  const setupSourceRef = useRef<SetupSource | undefined>(undefined);
  /** False when this page is a reload of a game that already had one. */
  const firstPageRef = useRef<boolean | null>(null);
  const leftRef = useRef(false);
  const mountedRef = useRef(false);
  const gameStartTimeRef = useRef<number>(Date.now());
  const finishedTrackedRef = useRef(false);

  useEffect(() => {
    // Guarded read — lib/game-storage.ts. No game here means setup.
    const data = loadGame();
    if (!data || data.tracks.length === 0) { router.push("/"); return; }
    // A guess game that landed here belongs on its own page, with its clips.
    if (data.mode !== "order") { router.replace("/game"); return; }
    // The deal is derived from the stored list, not stored itself, so a
    // reload reads the same list and deals the same rounds. A list that
    // deals nothing — a rollback, a hand-edited payload — has no game in it.
    const built = buildOrderRounds(data.tracks);
    if (built.rounds.length === 0) { router.push("/"); return; }
    // The start on `/` bumped the count before it navigated here, so the
    // count is this game's index. Read now and kept.
    const hostGames = getHostGameCount();
    hostKindRef.current = hostKindOf(hostGames);
    setupSourceRef.current = data.setupSource;
    // Claimed once per page, not once per effect run — StrictMode runs this
    // twice in development, and the second run would read its own page as a
    // reload.
    if (firstPageRef.current === null) {
      firstPageRef.current = claimFirstPage(
        gamePageStorage(),
        gameFingerprint(data.tracks, hostGames)
      );
    }
    setRounds(built.rounds);
    setLeftover(built.leftover);
    setPool(data.tracks);
    setPlayers(data.players);
    setPlaylistName(data.playlistName);
    setPlaylistSource(data.playlistSource);
    setMixedMeta(data.mixedPlaylistMeta ?? null);
    gameStartTimeRef.current = Date.now();
  }, [router]);

  // The phone is the screen, and left alone through an argument about 1997
  // it locks. Held for the whole game, final scores included.
  useScreenWakeLock(rounds.length > 0);

  // Which layout this is. In an effect because the server has no viewport.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_MEDIA_QUERY);
    const read = () => setScreen(gameScreenFor(query.matches));
    read();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", read);
      return () => query.removeEventListener("change", read);
    }
    query.addListener(read);
    return () => query.removeListener(read);
  }, []);

  /**
   * The page went away with the game unfinished. Once per page, first page
   * of a game only — the reasoning is `reportLeave` in app/game/page.tsx and
   * `claimFirstPage` in lib/game-beacons.ts, and it is the same here: a
   * reload is round one again with no start beacon.
   */
  const reportLeave = useCallback((via: "unload" | "navigation") => {
    if (leftRef.current) return;
    if (roundCountRef.current === 0) return;
    if (phaseRef.current === "finished") return;
    leftRef.current = true;
    if (firstPageRef.current === false) return;
    reportGameLeft(
      orderRoundsPlayed(currentIndexRef.current, phaseRef.current),
      hostKindRef.current,
      via,
      setupSourceRef.current,
      "order",
      playerBand(playersRef.current.length),
      gameScored(playersRef.current)
    );
  }, []);

  // `pagehide`, not `visibilitychange`: a phone that locks mid-argument
  // hides the tab and the game is still going. The unmount is the back
  // gesture, reported a tick late so StrictMode's remount is not a leave.
  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => reportLeave("unload");
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      window.setTimeout(() => {
        if (!mountedRef.current) reportLeave("navigation");
      }, 0);
    };
  }, [reportLeave]);

  function pulseScore(name: string) {
    setScorePulse(name);
    setTimeout(() => setScorePulse(null), 600);
  }

  /** Whoever called the whole order. One award per round. */
  function awardExact(requested: string) {
    if (exactWinner !== null) return;
    // The row keeps the scoreboard's spelling, whatever the tap carried.
    const playerName = scoreboardName(players, requested);
    if (playerName === null) return;
    setExactWinner(playerName);
    pulseScore(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + ORDER_EXACT_POINTS } : p))
    );
  }

  /** Whoever named the oldest song. The consolation, one per round. */
  function awardOldest(requested: string) {
    if (oldestWinner !== null) return;
    const playerName = scoreboardName(players, requested);
    if (playerName === null) return;
    setOldestWinner(playerName);
    pulseScore(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + ORDER_OLDEST_POINTS } : p))
    );
  }

  function reveal() {
    setPhase("revealed");
  }

  /**
   * A revealed round is closing — Next Round, or End Game with the years
   * up. Reports how the host scored it, once, to both destinations. A round
   * still face down is not a round played and reports nothing.
   */
  function closeRound() {
    if (phase !== "revealed") return;
    // GA4's round_completed is the guess game's and carries no mode, so it
    // is not sent from here; order_round_resolved is this game's round.
    reportOrderRound(
      orderVerdict({ exact: exactWinner !== null, oldest: oldestWinner !== null }),
      currentIndex + 1
    );
  }

  /**
   * Fire game_finished exactly once (guards endGame + nextRound double entry).
   * `endedEarly` is the caller's to say: End Game before the last reveal is
   * early; the last round closing is not.
   */
  function trackGameFinished(endedEarly: boolean) {
    if (finishedTrackedRef.current) return;
    finishedTrackedRef.current = true;
    const roundsPlayed = orderRoundsPlayed(currentIndex, phase);
    // The layout is read here, in the click: it names the screen this tap
    // is about to draw.
    const layout = readGameScreen();
    reportGameEnd(endedEarly ? "ended_early" : "played_out", roundsPlayed, {
      host: hostKindRef.current,
      ...(layout ? { screen: layout } : {}),
      ...(setupSourceRef.current ? { source: setupSourceRef.current } : {}),
      mode: "order",
      players: playerBand(players.length),
      scored: gameScored(players),
    });
    trackEvent("game_finished", {
      rounds_played: roundsPlayed,
      // Rounds, for this game: a card is not a track that was played.
      total_tracks: rounds.length,
      duration_seconds: Math.round((Date.now() - gameStartTimeRef.current) / 1000),
      playlist_source: playlistSource,
      game_mode: "order",
      ended_early: endedEarly,
      host_kind: hostKindRef.current,
    });
  }

  function nextRound() {
    closeRound();
    if (currentIndex + 1 >= rounds.length) {
      trackGameFinished(false);
      setPhase("finished");
    } else {
      // The ref moves with the state rather than a render behind it, for
      // the leave beacon.
      currentIndexRef.current = currentIndex + 1;
      setCurrentIndex((i) => i + 1);
      setPhase("showing");
      setExactWinner(null);
      setOldestWinner(null);
    }
  }

  function endGame() {
    closeRound();
    trackGameFinished(currentIndex + 1 < rounds.length || phase !== "revealed");
    setPhase("finished");
  }

  function playAgain() {
    reportGameOverTap("play_again", screen);
    router.push("/");
  }

  /** The phone's way onward from Game Over — a real href, routed client-side on a plain tap. */
  function openMixedSetup(event: ReactMouseEvent<HTMLAnchorElement>) {
    reportGameOverTap("mixed", screen);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.push(MIXED_SETUP_HREF);
  }

  /** Put the merged tracklist on the clipboard; show it if the browser refuses. */
  async function copyMixList() {
    const text = formatMixList({
      tracks: pool,
      contributorNames: mixedMeta?.contributorNames ?? [],
      playlistName,
    });
    try {
      await navigator.clipboard.writeText(text);
      setMixCopied(true);
      window.setTimeout(() => setMixCopied(false), 2500);
    } catch {
      setMixFallback(text);
    }
  }

  async function downloadResultImage() {
    const W = 640;
    const rowH = 64;
    const headerH = 200;
    const footerH = CARD_FOOTER_HEIGHT;
    const H = headerH + sortedPlayers.length * rowH + footerH;
    const { canvas, ctx } = createResultCanvas(W, H);

    drawCardBackground(ctx, W, H);
    drawCardHeader(ctx, {
      width: W,
      kicker: "GUESS SONG",
      title: "Final Scores",
      subtitle: `Order by year · ${playlistName}`,
    });

    sortedPlayers.forEach((p, idx) => {
      const y = headerH + idx * rowH;
      const isWinner = idx === 0 && p.score === maxScore && maxScore > 0;
      if (isWinner) {
        ctx.fillStyle = "rgba(29,185,84,0.08)";
        ctx.fillRect(24, y + 4, W - 48, rowH - 8);
      }
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = idx === 0 ? "#1DB954" : idx === 1 ? "#aaaaaa" : idx === 2 ? "#cd7f32" : "#333333";
      ctx.fillText(String(idx + 1), 44, y + rowH / 2 + 8);

      ctx.font = `${isWinner ? "700" : "500"} 18px sans-serif`;
      ctx.fillStyle = isWinner ? "#ffffff" : "#cccccc";
      let nameText = p.name;
      while (ctx.measureText(nameText).width > 360 && nameText.length > 1) {
        nameText = nameText.slice(0, -1);
      }
      if (nameText !== p.name) nameText += "…";
      ctx.fillText(nameText, 90, y + rowH / 2 + 8);

      ctx.font = "bold 28px sans-serif";
      ctx.fillStyle = isWinner ? "#1DB954" : "#555555";
      const scoreStr = String(p.score);
      ctx.fillText(scoreStr, W - 44 - ctx.measureText(scoreStr).width, y + rowH / 2 + 10);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#444";
      ctx.fillText("pts", W - 40, y + rowH / 2 + 10);
    });

    drawCardFooter(ctx, W, headerH + sortedPlayers.length * rowH + 20);
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

  const round = rounds[currentIndex];
  const isRevealed = phase === "revealed" || phase === "finished";
  // Face down: the deal's order. Revealed: oldest first, with each card's
  // slot in the deal beside it so a card that was already in the right
  // place lights up — the room's own reading of how close it was.
  const dealt = round?.tracks ?? [];
  const cards = isRevealed && round ? trueOrder(round) : dealt;
  const slotOf = new Map(dealt.map((t, i) => [t.id, i]));
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const maxScore = sortedPlayers[0]?.score ?? 0;
  const leftoverLine = orderLeftoverLine(leftover);
  const onward = gameOverOnward(screen);
  const lastRound = currentIndex + 1 >= rounds.length;

  if (rounds.length === 0) {
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
        /* A drag past the top of the card is Android's pull-to-refresh, and a
           refresh is round one with the scores wiped. */
        html, body { overscroll-behavior-y: none; }

        /* Phones: every control has a :active rule, so the platform's grey
           flash is noise on top of it; two quick taps on Next Round are not
           a zoom; nothing here is prose. Hover rules sit behind
           (hover: hover) throughout, because a tap leaves :hover applied. */
        button, a { -webkit-tap-highlight-color: transparent; }
        button { touch-action: manipulation; -webkit-user-select: none; user-select: none; }

        :root { --radius: 12px; }

        .game-layout {
          display: grid;
          grid-template-rows: 56px minmax(0, 1fr);
          /* minmax(0, 1fr), never 1fr: a bare 1fr lets the column grow to
             the top bar's one-line contents and run past a phone's edge
             under overflow: hidden. */
          grid-template-columns: minmax(0, 1fr) 300px;
          height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #111;
        }

        .top-bar {
          grid-column: 1 / -1;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
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
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .round-badge, .end-game-btn { flex-shrink: 0; }

        .main-area {
          position: relative;
          overflow-y: auto;
          overflow-x: hidden;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 32px;
        }

        .game-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 540px;
          background: rgba(20,20,20,0.92);
          border: 1px solid #2a2a2a;
          border-radius: var(--radius);
          padding: 24px 28px 28px;
          backdrop-filter: blur(20px);
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }

        /* The four cards. One column: a row is a title, a credit and a
           cover, and four of them read top to bottom as "a list to put in
           order" where a grid reads as four unrelated tiles. */
        .order-prompt {
          text-align: center;
          color: #555;
          font-size: 13px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .order-prompt.revealed { color: #1DB954; }
        .order-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
        .order-card {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          padding: 8px 12px 8px 10px;
          background: #161616;
          border: 1.5px solid #262626;
          border-radius: var(--radius);
        }
        /* Already in the right slot when the years went up. */
        .order-card.in-place { border-color: rgba(29,185,84,0.6); background: rgba(29,185,84,0.07); }
        .order-slot {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          line-height: 1;
          color: #444;
          width: 22px;
          text-align: center;
          flex-shrink: 0;
          letter-spacing: 0.04em;
        }
        .order-card.in-place .order-slot { color: #1DB954; }
        .order-art {
          width: 56px;
          height: 56px;
          border-radius: 8px;
          object-fit: cover;
          background: #1a1a1a;
          flex-shrink: 0;
          /* The cover is a hint, not an answer, but a long press on iOS
             still opens a sheet over the game. */
          pointer-events: none;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
        .order-text { flex: 1; min-width: 0; }
        .order-title {
          font-size: 15px;
          font-weight: 600;
          color: #f0f0f0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .order-artist, .order-album, .order-from {
          font-size: 12.5px;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .order-artist { color: #888; }
        .order-album { color: #555; font-size: 11.5px; }
        .order-from { color: #1DB954; font-size: 11.5px; }
        .order-year {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 26px;
          line-height: 1;
          color: #1DB954;
          letter-spacing: 0.04em;
          flex-shrink: 0;
          min-width: 52px;
          text-align: right;
          text-shadow: 0 0 16px rgba(29,185,84,0.4);
          animation: pop-in 0.3s cubic-bezier(0.175,0.885,0.32,1.275);
        }
        @keyframes pop-in { from{transform:scale(0.6);opacity:0} to{transform:scale(1);opacity:1} }
        .order-note { margin-top: 10px; font-size: 12px; line-height: 1.4; color: #555; text-align: center; }

        .btn-primary {
          display: block;
          width: 100%;
          padding: 12px;
          background: #1DB954;
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 15px;
          font-weight: 700;
          border: none;
          border-radius: var(--radius);
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        @media (hover: hover) { .btn-primary:hover { background: #1ed760; transform: translateY(-1px); } }
        /* Pressed states land on touchstart: transition: none here, so the
           ease on the base rule runs on release only. */
        .btn-primary:active { transform: scale(0.98); transition: none; }
        .btn-primary.next { margin: 0 auto; min-width: 180px; width: fit-content; }

        .btn-ghost {
          padding: 12px 16px;
          background: transparent;
          color: #666;
          font-family: 'Outfit', sans-serif;
          font-size: 14px;
          font-weight: 500;
          border: 1.5px solid #2a2a2a;
          border-radius: var(--radius);
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        @media (hover: hover) { .btn-ghost:hover { border-color: #444; color: #999; } }
        .btn-ghost:active { border-color: #444; color: #999; background: rgba(255,255,255,0.06); transform: scale(0.98); transition: none; }
        .btn-ghost.compact { padding: 9px 14px; min-height: 36px; font-size: 12.5px; font-weight: 500; color: #777; }

        .end-game-btn {
          background: none;
          border: 1px solid #2a2a2a;
          border-radius: var(--radius);
          color: #888;
          font-size: 12px;
          font-family: 'Outfit', sans-serif;
          font-weight: 600;
          padding: 6px 12px;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
        }
        @media (hover: hover) { .end-game-btn:hover { color: #1DB954; border-color: #1DB954; } }
        .end-game-btn:active { color: #1DB954; border-color: #1DB954; transform: scale(0.97); transition: none; }

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
          border-radius: var(--radius);
          font-family: 'Outfit', sans-serif;
          font-size: 14px;
          font-weight: 600;
          border: 1.5px solid #2a2a2a;
          background: #1a1a1a;
          color: #ccc;
          cursor: pointer;
          transition: all 0.15s;
        }
        @media (hover: hover) { .player-pick-btn:hover { border-color: #1DB954; color: #1DB954; background: rgba(29,185,84,0.08); } }
        .player-pick-btn:active { background: rgba(29,185,84,0.15); border-color: #1DB954; transform: scale(0.97); transition: none; }
        .player-pick-btn.compact { padding: 8px 12px; min-height: 32px; font-size: 12px; font-weight: 500; color: #999; }
        .score-row-compact {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-bottom: 14px;
        }
        .score-row-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #999;
          flex-basis: 100%;
          text-align: center;
          white-space: nowrap;
        }
        .score-row-done { font-size: 12px; color: #1DB954; }
        .awarded-line { text-align: center; color: #1DB954; font-size: 13px; margin-bottom: 14px; }

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

        /* FINISHED STATE — the game page's, so the two Game Overs are one screen */
        .finished-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(10,10,10,0.97);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding: 28px 24px calc(24px + env(safe-area-inset-bottom));
          animation: fade-in 0.4s ease;
          overflow-x: hidden;
          overflow-y: auto;
        }
        @keyframes fade-in { from{opacity:0} to{opacity:1} }
        .finished-header { flex-shrink: 0; text-align: center; width: 100%; max-width: 480px; }
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
        .winner-hero {
          flex-shrink: 0;
          width: 100%;
          max-width: 480px;
          background: linear-gradient(135deg, rgba(29,185,84,0.15) 0%, rgba(29,185,84,0.05) 100%);
          border: 1px solid rgba(29,185,84,0.35);
          border-radius: var(--radius);
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
          border-radius: var(--radius);
          overflow-y: auto;
          overflow-x: hidden;
          flex: 1 1 0;
          /* Gives way down to three rows, never to nothing. */
          min-height: 132px;
          margin-bottom: 16px;
        }
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
        .mix-fallback {
          width: 100%;
          max-width: 480px;
          height: 160px;
          margin-top: 12px;
          padding: 10px 12px;
          background: #1a1a1a;
          color: #ddd;
          border: 1px solid #333;
          border-radius: 8px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          /* Focusable (it selects itself on focus): the 16px floor applies. */
          font-size: 16px;
          line-height: 1.5;
          resize: vertical;
          flex-shrink: 0;
        }
        .btn-lg {
          flex-shrink: 0;
          width: 100%;
          max-width: 480px;
          padding: 13px 24px;
          font-family: 'Outfit', sans-serif;
          font-size: 15px;
          font-weight: 700;
          border-radius: var(--radius);
          cursor: pointer;
          transition: all 0.15s;
          border: none;
          white-space: nowrap;
        }
        .btn-lg.green { background: #1DB954; color: #000; box-shadow: 0 4px 24px rgba(29,185,84,0.3); }
        @media (hover: hover) { .btn-lg.green:hover { background: #1ed760; transform: translateY(-1px); box-shadow: 0 4px 32px rgba(29,185,84,0.5); } }
        .btn-lg.green:active { transform: scale(0.985); transition: none; }
        .finished-secondary {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
          flex-shrink: 0;
          width: 100%;
          max-width: 480px;
          margin-top: 10px;
        }
        .next-game-link {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          max-width: 480px;
          min-height: 44px;
          margin-top: 6px;
          padding: 6px 12px;
          color: #1DB954;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.3;
          text-align: center;
          text-decoration: none;
          border-radius: var(--radius);
          transition: color 0.15s, background 0.15s;
        }
        @media (hover: hover) { .next-game-link:hover { color: #1ed760; background: rgba(29,185,84,0.08); } }
        .next-game-link:active { background: rgba(29,185,84,0.14); transform: scale(0.985); transition: none; }

        /* PHONES. The host's phone is a remote control: four cards, the
           prompt and Reveal on one screen, and at the reveal the picker and
           Next Round still under the thumb. Measured on 390×844: four 56px
           rows and the controls come to ~520px of a 590px area. */
        @media (max-width: 768px) {
          .game-layout {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: 56px minmax(0, 1fr) auto;
          }
          .top-bar { padding: 0 14px; }
          .playlist-name { max-width: none; flex: 1; text-align: center; }
          .end-game-btn { font-size: 11px; padding: 8px 12px; min-height: 40px; }
          .main-area { padding: 14px 14px 20px; }
          .game-card { padding: 16px 14px 16px; }
          .order-art { width: 48px; height: 48px; }
          .order-card { gap: 10px; padding: 7px 10px 7px 8px; }
          .order-title { font-size: 14px; }
          .order-year { font-size: 24px; min-width: 46px; }
          /* Thumb-sized. 44px is the floor for anything tapped once a
             round; the bonus chips are tapped less and read as secondary. */
          .btn-primary { min-height: 48px; font-size: 16px; }
          .btn-ghost { min-height: 44px; }
          .btn-ghost.compact { min-height: 40px; }
          .player-pick-btn { min-height: 44px; padding: 9px 16px; font-size: 15px; }
          .player-pick-btn.compact { min-height: 36px; }
          .player-picker { gap: 8px; }
          .score-row-label { text-align: center; }

          .sidebar {
            border-left: none;
            border-top: 1px solid #1e1e1e;
            max-height: none;
            padding-bottom: env(safe-area-inset-bottom);
          }
          .sidebar-header { display: none; }
          .score-list {
            display: flex;
            gap: 6px;
            padding: 8px 12px;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior-x: contain;
            scroll-snap-type: x proximity;
            scroll-padding-inline: 12px;
          }
          .score-list::-webkit-scrollbar { display: none; }
          .score-row {
            flex: 0 0 auto;
            scroll-snap-align: start;
            gap: 8px;
            padding: 6px 12px 6px 10px;
            border-radius: var(--radius);
            background: #161616;
            border: 1px solid #222;
          }
          .score-row.leader { background: rgba(29,185,84,0.08); border-color: rgba(29,185,84,0.35); }
          .score-row-left { gap: 6px; }
          .rank-num { width: auto; color: #666; }
          .player-name-score { font-size: 13px; max-width: 120px; }
          .score-chip { font-size: 18px; line-height: 1; color: #aaa; }

          /* A short phone (375×667, an iPhone SE: ~550px of viewport in
             Safari). Four full cards, the picker and Next Round did not fit
             without a scroll, so everything gives a little: smaller art,
             tighter rows, the album line and the artist line one size down.
             Measured with four players at the reveal. */
          @media (max-height: 700px) {
            .main-area { padding: 10px 12px 12px; }
            .game-card { padding: 12px 12px 12px; }
            .order-prompt { margin-bottom: 8px; font-size: 12px; }
            .order-list { gap: 6px; margin-bottom: 10px; }
            .order-card { padding: 5px 10px 5px 8px; }
            .order-art { width: 40px; height: 40px; }
            .order-title { font-size: 13.5px; }
            .order-artist { font-size: 12px; margin-top: 0; }
            .order-album, .order-from { display: none; }
            .order-year { font-size: 22px; }
            .who-scored { margin-bottom: 6px; }
            .player-picker { margin-bottom: 8px; }
            .player-pick-btn { min-height: 44px; padding: 8px 14px; }
            .score-row-compact { margin-bottom: 8px; }
            .btn-primary { min-height: 46px; }
            /* Four players' names wrap the picker to two rows and the reveal
               ran ~60px past the fold. Rather than shrink the scoring rows
               further, Next Round rides the bottom edge until its own slot
               scrolls into view: however many players, it is never a scroll
               away. */
            .btn-primary.next {
              position: sticky;
              bottom: 6px;
              z-index: 2;
              box-shadow: 0 -10px 18px rgba(20,20,20,0.95);
            }
          }

          /* Fixed to the viewport, so body's side insets do not reach it. */
          .finished-overlay {
            padding:
              20px
              max(16px, env(safe-area-inset-right))
              calc(16px + env(safe-area-inset-bottom))
              max(16px, env(safe-area-inset-left));
          }
        }
      `}</style>

      <div className="game-layout">
        <header className="top-bar">
          <div className="round-badge">
            <span>Round</span>
            <span className="round-num">
              {phase === "finished" ? rounds.length : currentIndex + 1}
            </span>
            <span style={{ color: "#333" }}>/</span>
            <span>{rounds.length}</span>
          </div>
          <span className="playlist-name">{playlistName}</span>
          {phase !== "finished" && (
            <button className="end-game-btn" onClick={endGame}>
              End Game
            </button>
          )}
        </header>

        <main className="main-area">
          <div className="game-card">
            <p className={`order-prompt${isRevealed ? " revealed" : ""}`}>
              {isRevealed ? "Oldest to newest — the real order" : "Oldest → newest. Agree on an order, then reveal"}
            </p>

            <div className="order-list">
              {cards.map((t, i) => {
                const slot = slotOf.get(t.id) ?? i;
                const inPlace = isRevealed && slot === i;
                return (
                  <div key={t.id} className={`order-card${inPlace ? " in-place" : ""}`}>
                    <span className="order-slot" aria-label={isRevealed ? `Rank ${i + 1}` : `Card ${i + 1}`}>
                      {isRevealed ? i + 1 : String.fromCharCode(65 + i)}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={t.albumImageUrl || ALBUM_PLACEHOLDER}
                      alt=""
                      className="order-art"
                      draggable={false}
                    />
                    <div className="order-text">
                      {/* The cleaned title, and the album only once the years
                          are up: "Karma Police - Remastered 2011" and an album
                          called "1989" both name a year on a face-down card. */}
                      <p className="order-title">{displayTitle(t.name)}</p>
                      <p className="order-artist">{t.artists.join(", ")}</p>
                      {isRevealed && t.albumName && <p className="order-album">{t.albumName}</p>}
                      {isRevealed && t.contributors && t.contributors.length > 0 && (
                        <p className="order-from">
                          {t.contributors.length > 1
                            ? `${t.contributors.join(" & ")}'s playlists`
                            : `${t.contributors[0]}'s playlist`}
                        </p>
                      )}
                    </div>
                    {isRevealed && <span className="order-year">{releaseYear(t)}</span>}
                  </div>
                );
              })}
            </div>

            {phase === "showing" && (
              <div>
                <button className="btn-primary" onClick={reveal}>
                  Reveal the Years →
                </button>
                {leftoverLine && <p className="order-note">{leftoverLine}</p>}
              </div>
            )}

            {phase === "revealed" && (
              <div>
                {/* The whole order, the round's question. One award. */}
                {exactWinner === null ? (
                  <>
                    <p className="who-scored">Who called the full order? (+{ORDER_EXACT_POINTS} pts)</p>
                    <div className="player-picker">
                      {players.map((p) => (
                        <button key={p.name} className="player-pick-btn" onClick={() => awardExact(p.name)}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="awarded-line">+{ORDER_EXACT_POINTS} pts → {exactWinner}</p>
                )}

                {/* The oldest song alone, the consolation. Compact, like the
                    guess game's album row: the order is the question. */}
                <div className="score-row-compact">
                  <span className="score-row-label">Oldest song +{ORDER_OLDEST_POINTS}</span>
                  {oldestWinner === null ? (
                    players.map((p) => (
                      <button
                        key={p.name}
                        className="player-pick-btn compact"
                        onClick={() => awardOldest(p.name)}
                      >
                        {p.name}
                      </button>
                    ))
                  ) : (
                    <span className="score-row-done">+{ORDER_OLDEST_POINTS} pt → {oldestWinner}</span>
                  )}
                </div>

                <button className="btn-primary next" onClick={nextRound}>
                  {lastRound ? "See Final Scores →" : "Next Round →"}
                </button>
              </div>
            )}
          </div>

          {phase === "finished" && (
            <div className="finished-overlay">
              <div className="finished-header">
                <p style={{ fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#555", marginBottom: "4px" }}>
                  Game Over
                </p>
                <h1 className="finished-title">Final Scores</h1>
                <p style={{ color: "#444", fontSize: "13px" }}>{playlistName}</p>
              </div>

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

              {sortedPlayers.length > 1 && (
                <div className="final-scoreboard">
                  {sortedPlayers.slice(1).map((p, i) => {
                    const idx = i + 1;
                    const rankClass = idx === 1 ? "second" : idx === 2 ? "third" : "rest";
                    return (
                      <div key={p.name} className="final-row">
                        <span className={`final-rank ${rankClass}`}>{idx + 1}</span>
                        <span className="final-name">{p.name}</span>
                        <span className={`final-score${idx <= 2 ? " podium" : ""}`}>{p.score}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <button className="btn-lg green" onClick={playAgain}>
                Play Again →
              </button>
              <div className="finished-secondary">
                <button className="btn-ghost compact" onClick={downloadResultImage}>
                  Save Results
                </button>
                {playlistSource === "mixed" && (
                  <button className="btn-ghost compact" onClick={copyMixList}>
                    {mixCopied ? "Copied ✓" : "Copy the Mix"}
                  </button>
                )}
              </div>

              {mixFallback && (
                <textarea
                  className="mix-fallback"
                  readOnly
                  value={mixFallback}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="The mixed playlist, ready to copy"
                />
              )}

              {/* The QR for a room looking at a shared screen; a link for a
                  host holding the screen. Not rendered on a phone, because
                  rendering is what reports its impression. lib/game-over.ts. */}
              {onward === "qr" && <LoopQr />}
              {onward === "mixed_link" && (
                <a className="next-game-link" href={MIXED_SETUP_HREF} onClick={openMixedSetup}>
                  {MIXED_NEXT_GAME_LABEL}
                </a>
              )}
            </div>
          )}
        </main>

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
    </>
  );
}
