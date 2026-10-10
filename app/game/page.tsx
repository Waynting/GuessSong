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
import { canInstall, promptInstall } from "@/lib/pwa";
import {
  countRoundsPlayed,
  mergeRoomRoster,
  scoreboardName,
  type GameMode,
  type GamePlayer as Player,
  type BuzzerRoomHandle,
  type MixedPlaylistMeta,
} from "@/lib/game-session";
import { loadGame } from "@/lib/game-storage";
import { useScreenWakeLock } from "@/lib/wake-lock";
import { fetchPreview, fetchPreviewBatch } from "@/lib/preview-client";
import { createRoundToken } from "@/lib/round-token";
import { announcesNoScore } from "@/lib/round-outcome";
import { isPreviewSettled, type PreviewBatchTrack } from "@/types/preview";
import { BuzzerHostPanel, type BuzzerControls } from "@/components/buzzer-host-panel";
import { LoopQr } from "@/components/loop-qr";
import { closeRoundEntry, type RoundHistoryEntry } from "@/lib/round-history";
import { describeRounds, summarizeRounds } from "@/lib/round-summary";
import { formatMixList } from "@/lib/mix-export";
import { buildTasteCard } from "@/lib/taste-card";
import {
  CARD_FOOTER_HEIGHT,
  createResultCanvas,
  drawCardBackground,
  drawCardHeader,
  drawCardFooter,
  shareOrDownloadCanvas,
} from "@/lib/result-image";
import {
  reportFirstClip,
  reportGameEnd,
  reportGameLeft,
  reportGameOverTap,
} from "@/lib/loop-client";
import type { FirstClipOutcome, GameHostKind, GameScreen, SetupSource } from "@/lib/loop-stats";
import { getHostGameCount } from "@/lib/host-session";
import {
  CLIP_COPY,
  afterClipError,
  afterPlayRejected,
  afterSoundStarted,
  startPlayback,
  type ClipMiss,
  type ClipSite,
  type PlaybackResult,
} from "@/lib/clip-start";
import { createClipClock } from "@/lib/clip-clock";
import { createFirstClipTracker, firstClipPath } from "@/lib/first-clip";
import { dropSilentUpcoming, silentSkippedLine } from "@/lib/track-queue";
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

type Phase = "waiting" | "playing" | "guessing" | "revealed" | "finished";

/**
 * A `play()` the page has asked for and the element has not answered yet.
 * Carries its own round token, so whatever answers it can tell whether the
 * round it was asked in is still the one on screen.
 */
interface SoundRequest {
  site: ClipSite;
  stillThisRound: () => boolean;
}

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
          Next time, share a playlist from Spotify straight into the game.
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
  // The clip is stopped mid-round but resumable. Set when someone buzzes in:
  // the music gets out of the way so the room can hear the answer, and the host
  // decides whether to let it run on.
  const [clipPaused, setClipPaused] = useState(false);
  // Mirrors the <audio> element itself, so the Stop/Resume toggle can't claim
  // the music is running when it isn't. `clipPaused` says "held mid-round";
  // this says "is sound coming out right now", and the clip ending on its own
  // changes the second without the first.
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [scorePulse, setScorePulse] = useState<string | null>(null);
  const [pointsAwarded, setPointsAwarded] = useState(false);
  const [albumPointsAwarded, setAlbumPointsAwarded] = useState(false);
  const [sourcePointsAwarded, setSourcePointsAwarded] = useState(false);
  const [roundHistory, setRoundHistory] = useState<RoundHistoryEntry[]>([]);
  const [albumHintShown, setAlbumHintShown] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  /**
   * Why this round has no clip, or null. Two values rather than the boolean
   * it used to be, because they are two different things to tell a host:
   * `absent` is the song's, `unavailable` is ours and gets a Retry. See
   * CLIP_COPY in lib/clip-start.ts.
   */
  const [clipMiss, setClipMiss] = useState<ClipMiss | null>(null);
  /** The browser refused a play(), and the host is being asked to tap again. */
  const [playBlocked, setPlayBlocked] = useState(false);
  const [loadingSkipVisible, setLoadingSkipVisible] = useState(false);
  /** Known-silent tracks taken out of the queue — lib/track-queue.ts. */
  const [silentSkipped, setSilentSkipped] = useState(0);
  /**
   * The pool as it was loaded, which `tracks` stops being once silent rounds
   * are dropped from it. The mix list and the taste card describe the
   * evening's music, not the rounds that could be played: built from the
   * queue, a contributor whose songs all lacked a clip would be reported as
   * having had none of their playlist make the pool.
   */
  const [pool, setPool] = useState<Track[]>([]);
  /** Null until an effect has asked — see gameScreenFor in lib/game-over.ts. */
  const [screen, setScreen] = useState<GameScreen | null>(null);
  const [playlistSource, setPlaylistSource] = useState<PlaylistSource>("own");
  const [mixedMeta, setMixedMeta] = useState<MixedPlaylistMeta | null>(null);
  const [mixCopied, setMixCopied] = useState(false);
  const [mixFallback, setMixFallback] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>("party");
  // Read by the leave beacon, which fires from a listener registered once.
  const modeRef = useRef<GameMode>("party");
  modeRef.current = mode;
  const [installCta, setInstallCta] = useState(false);
  // Buzzer Mode only. Null in every other mode, which is also how the panel
  // stays entirely out of the party render path.
  const [buzzerRoom, setBuzzerRoom] = useState<BuzzerRoomHandle | null>(null);
  // Handed up by the panel so this page's existing Reveal / Next / scoring
  // buttons drive the room, instead of the panel growing its own copies.
  const [buzzerControls, setBuzzerControls] = useState<BuzzerControls | null>(null);
  const peakPhonesRef = useRef(0);
  // reveal()/nextTrack() are plain functions recreated each render; reading the
  // controls through a ref keeps them from going stale without threading state
  // through every call site.
  const buzzerControlsRef = useRef<BuzzerControls | null>(null);
  buzzerControlsRef.current = buzzerControls;

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clip time is accounted in segments rather than from one start timestamp,
  // because a pause splits the clip into several. Without this a 15s clip
  // paused for 20s would end the moment it resumed — the deadline was wall
  // clock, not playback. The arithmetic is lib/clip-clock.ts.
  const clockRef = useRef(createClipClock());
  // Read by the buzz handler, which must not re-subscribe on every phase change.
  const phaseRef = useRef<Phase>("waiting");
  phaseRef.current = phase;
  // Read by what outlives a render: the prefetch's answer, which lands
  // seconds after the effect that asked, and the leave beacon, which fires
  // from a listener registered once.
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  /**
   * The one `play()` still waiting on the element, or null. Set by the ask,
   * cleared by whatever answers it — and by anything that stops the clip,
   * *before* it pauses, because the pause is what rejects the promise.
   */
  const soundRequestRef = useRef<SoundRequest | null>(null);
  /**
   * Which press the loading affordances belong to. Two rounds' lookups can be
   * in flight at once, so "Skip Track appears after 1.5s" must only ever
   * answer for the press that started the wait: a timer that fired for an
   * abandoned round would otherwise hand the *next* round its Skip button
   * early, and one that was cleared by it would take the button away.
   */
  const busyRef = useRef(0);
  /**
   * Which round the host is looking at. See lib/round-token.ts for the rule and
   * for why it is not written inline here.
   *
   * playClip renders the "Skip Track" button *during* its own await, 1500ms in,
   * so a host advancing while a preview resolves is the ordinary case rather
   * than a corner one.
   */
  const roundsRef = useRef(createRoundToken());
  /**
   * Only ever holds *settled* answers — a found URL, or a confirmed null for a
   * song nothing has a clip for. An "unavailable" is never written here: it
   * means the server could not ask, and remembering it would turn one throttled
   * moment into a track that stays silent for the rest of the game.
   */
  const previewCache = useRef<Record<string, string | null>>({});
  /** One repair attempt per track, so a genuinely dead URL can't loop. */
  const refreshedTracks = useRef<Set<string>>(new Set());
  /**
   * The track whose repair is in flight, if any. A failing element can fire
   * `error` more than once, and the second must neither start a second
   * repair nor be read as "repaired already, and failed again".
   */
  const repairingRef = useRef<string | null>(null);
  const gameStartTimeRef = useRef<number>(Date.now());
  const finishedTrackedRef = useRef(false);
  /** The first Play press of this page, reported once — lib/first-clip.ts. */
  const firstClipRef = useRef(createFirstClipTracker());
  /** Read on mount; "unknown" until then and whenever storage will not say. */
  const hostKindRef = useRef<GameHostKind>("unknown");
  // How the playlist got into the setup form, off the stored payload. Absent
  // for a game stored before the payload carried it; the beacons then send
  // none, as they always did.
  const setupSourceRef = useRef<SetupSource | undefined>(undefined);
  /**
   * False when this page is a reload of a game that already had one. Null
   * until the game has loaded. See claimFirstPage in lib/game-beacons.ts for
   * why a restarted page sends neither a first clip nor a leave.
   */
  const firstPageRef = useRef<boolean | null>(null);
  const leftRef = useRef(false);
  const mountedRef = useRef(false);
  const prefetchAskedRef = useRef(false);

  /**
   * The clip transport, identical in "playing" and "guessing".
   *
   * It has to be the same set in both, because the phase flips underneath the
   * host constantly — a buzz holds the clip, Resume puts it back to "playing",
   * Stop drops it to "guessing", the clip running out does the same. When the
   * two phases rendered different rows, buttons appeared and vanished as a
   * side effect of that churn, and the host lost whichever control they were
   * reaching for. One block, always the same set, until Reveal ends the round.
   *
   * Reveal is the only primary control: it is the one the host presses every
   * round. Stop/Resume, Replay and the album-art hint sit under it as one
   * compact row, so the eye lands on the action and not on a bank of equally
   * weighted buttons.
   */
  function clipControls() {
    return (
      <div className="clip-controls">
        <button className="btn-primary" onClick={reveal}>
          Reveal Answer →
        </button>
        <div className="clip-secondary">
          {audioPlaying ? (
            <button className="btn-ghost compact" onClick={holdClip}>
              Stop
            </button>
          ) : (
            <button className="btn-ghost compact" onClick={resumeClip}>
              Resume
            </button>
          )}
          <button className="btn-ghost compact" onClick={replayClip}>
            Replay
          </button>
          {currentTrack?.albumImageUrl && (
            <button
              className={`btn-ghost compact${albumHintShown ? " used" : ""}`}
              onClick={() => setAlbumHintShown(true)}
              disabled={albumHintShown}
            >
              {albumHintShown ? "Album Art Shown" : "Show Album Art Hint"}
            </button>
          )}
        </div>
      </div>
    );
  }

  /**
   * The waiting-phase escape hatch, shared by the "still finding audio" and
   * "no audio" branches so the pair cannot drift apart.
   *
   * Retry is here rather than in a branch of its own for that reason, and it
   * is offered for `unavailable` only: that one is about us and clears, so
   * asking again can answer differently. `absent` is settled — the cache
   * would hand the same null straight back — and a button that cannot work
   * teaches the host that none of them do. Reveal stays the primary: the
   * server holds an `unavailable` for ninety seconds, so a second ask inside
   * that window is told the same thing.
   */
  function skipControls() {
    const canRetry = clipMiss === "unavailable" && !previewLoading;
    return (
      <div className={`btn-row${canRetry ? " with-retry" : ""}`}>
        <button className="btn-primary" onClick={reveal}>
          Reveal Answer →
        </button>
        {canRetry && (
          <button className="btn-ghost" onClick={playClip}>
            {CLIP_COPY.retry}
          </button>
        )}
        <button className="btn-ghost" onClick={nextTrack}>
          Skip Track
        </button>
      </div>
    );
  }

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
    // Guarded, because a browser with site data switched off throws on the
    // read rather than returning null — and this effect has no try of its own,
    // so the throw took the whole page down. See lib/game-storage.ts.
    const data = loadGame();
    if (!data || data.tracks.length === 0) { router.push("/"); return; }
    // A "put them in order" game has its own page and no audio. It must
    // leave here before `setTracks`, because the prefetch effect below keys
    // on `tracks.length` and would spend a batch of preview lookups on a
    // game that will never press Play — the one cost that mode exists to
    // avoid. `replace`, so Back does not land on this page again.
    if (data.mode === "order") { router.replace("/order"); return; }
    setTracks(data.tracks);
    setPool(data.tracks);
    // The start on `/` bumped the count before it navigated here, so the
    // count is this game's index. Read now and kept: a second tab starting
    // its own game later must not change what this one reports at its end.
    const hostGames = getHostGameCount();
    hostKindRef.current = hostKindOf(hostGames);
    setupSourceRef.current = data.setupSource;
    // Claimed once per page, not once per effect run — StrictMode runs this
    // twice in development, and the second run would find the first's marker
    // and read its own page as a reload.
    if (firstPageRef.current === null) {
      firstPageRef.current = claimFirstPage(
        gamePageStorage(),
        gameFingerprint(data.tracks, hostGames)
      );
    }
    setPlayers(data.players);
    setPlaylistName(data.playlistName);
    setClipDuration(data.clipDuration);
    setPlaylistSource(data.playlistSource);
    setMode(data.mode);
    setBuzzerRoom(data.buzzerRoom ?? null);
    // The roster, kept separately from the tracks on purpose. `contributorNames`
    // is the only record of somebody whose playlist was sampled down to nothing:
    // they are absent from every track, so anything derived from `tracks` erases
    // them from an evening they took part in.
    setMixedMeta(data.mixedPlaylistMeta ?? null);
    gameStartTimeRef.current = Date.now();
  }, [router]);

  // The phone is the screen and the speaker, and left alone through a long
  // guess it locks, which pauses the clip. Held for the whole game, final
  // scores included — that is the screen the room scans the QR off.
  useScreenWakeLock(tracks.length > 0);

  /**
   * Resolve the whole game's previews in one request, before the first round.
   *
   * Not just a latency win. Resolving lazily put an upstream lookup on the
   * critical path of every round, so a throttled minute reached the host as a
   * dead Play button mid-party — the one moment there is nothing to do about
   * it. Done here, the same throttling costs a few seconds before anyone has
   * pressed anything, and the tracks it couldn't answer for simply fall back to
   * the per-track path as the game reaches them.
   *
   * Deliberately not awaited by anything: the host can start immediately, and
   * playClip reads whatever has landed by then.
   *
   * **Asked once per page, and the guard is what makes dropping tracks safe.**
   * The answer below takes the known-silent rounds out of `tracks`, and this
   * effect depends on `tracks` — so without `prefetchAskedRef` every drop
   * would re-run it and send a second batch made of exactly the tracks the
   * first could not settle: the throttled ones, re-asked the moment they were
   * refused, on the hottest path in the app. They take the lazy path instead,
   * when the game reaches them, which is what they did before.
   *
   * The answer is kept for as long as the page is mounted, not until this
   * effect's next cleanup. The cleanup runs whenever `tracks` changes, and
   * with the guard above an answer cancelled by it is never asked for again.
   */
  useEffect(() => {
    if (tracks.length === 0 || prefetchAskedRef.current) return;

    const pending: PreviewBatchTrack[] = tracks
      .filter((t) => previewCache.current[t.id] === undefined)
      .map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artists[0] ?? "",
        durationMs: t.durationMs,
      }));
    if (pending.length === 0) return;
    prefetchAskedRef.current = true;

    void fetchPreviewBatch(pending).then((resolved) => {
      if (!mountedRef.current) return;
      for (const [id, result] of resolved) {
        if (isPreviewSettled(result.status)) previewCache.current[id] = result.previewUrl;
      }
      // The refs, not this closure's `tracks` and index: the batch takes
      // seconds, and the host has been free to play for all of them.
      const { queue, dropped } = dropSilentUpcoming(
        tracksRef.current,
        currentIndexRef.current,
        previewCache.current
      );
      if (dropped === 0) return;
      setTracks([...queue]);
      setSilentSkipped((n) => n + dropped);
    });
  }, [tracks]);

  // Which layout this is. In an effect because the server has no viewport —
  // see gameScreenFor. Re-read on change: a phone turned on its side crosses
  // the breakpoint, and the stylesheet follows it whether this does or not.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_MEDIA_QUERY);
    const read = () => setScreen(gameScreenFor(query.matches));
    read();
    // Safari before 14 has only the deprecated pair.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", read);
      return () => query.removeEventListener("change", read);
    }
    query.addListener(read);
    return () => query.removeListener(read);
  }, []);

  /**
   * Report how the first Play press came out. Safe to call from anywhere, any
   * number of times: the tracker answers once, for the first press only.
   */
  const settleFirstClip = useCallback((outcome: FirstClipOutcome) => {
    const report = firstClipRef.current.settle(outcome);
    if (!report || firstPageRef.current === false) return;
    reportFirstClip(report.path, report.outcome);
  }, []);

  /**
   * The game page went away with the game unfinished.
   *
   * Once per page. A page restored from the back/forward cache is the same
   * page, so it does not report a second leave — and if its game then reaches
   * Game Over it is in both counts, which is a thing to know when reading
   * them rather than a thing this can take back.
   */
  const reportLeave = useCallback(
    (via: "unload" | "navigation") => {
      if (leftRef.current) return;
      // No game was ever on this page: the payload was missing and the mount
      // effect is already sending the host back to setup.
      if (tracksRef.current.length === 0) return;
      if (phaseRef.current === "finished") return;
      leftRef.current = true;
      // A press still waiting on its clip is a press that came to nothing.
      settleFirstClip("abandoned");
      if (firstPageRef.current === false) return;
      reportGameLeft(
        countRoundsPlayed(currentIndexRef.current, phaseRef.current),
        hostKindRef.current,
        via,
        setupSourceRef.current,
        modeRef.current
      );
    },
    [settleFirstClip]
  );

  /**
   * `pagehide`, not `visibilitychange`. A phone that locks mid-party hides
   * the tab and the party is still going; counting that as leaving would file
   * every long guess under "left at round N".
   *
   * The unmount is the other way off this page and fires no `pagehide`: the
   * back gesture is a client-side navigation, so the document lives on and
   * only the component goes. It is reported a tick late on purpose —
   * StrictMode unmounts and remounts every component once in development,
   * and a leave sent from that would be a real beacon for a game nobody left.
   */
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

  const stopClipTimers = useCallback(() => {
    if (clipTimeoutRef.current) clearTimeout(clipTimeoutRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    clipTimeoutRef.current = null;
    progressIntervalRef.current = null;
  }, []);

  /**
   * Show the spinner for this press, and the way out of it 1.5s later if the
   * press is still the one being waited on. Covers both waits a press can
   * have — the lookup, and the element loading what the lookup found — as
   * one, counted from the tap, because the host is waiting from the tap.
   */
  const beginBusy = useCallback(() => {
    const mine = ++busyRef.current;
    setPreviewLoading(true);
    setLoadingSkipVisible(false);
    window.setTimeout(() => {
      if (busyRef.current === mine) setLoadingSkipVisible(true);
    }, 1500);
  }, []);

  /** The wait is over, however it ended. Retires the press's timer with it. */
  const endBusy = useCallback(() => {
    busyRef.current += 1;
    setPreviewLoading(false);
    setLoadingSkipVisible(false);
  }, []);

  const stopClip = useCallback(() => {
    // Before the pause, not after: pausing rejects a play() that is still
    // pending, and whatever this browser calls that rejection, it has to
    // find no request left to answer.
    soundRequestRef.current = null;
    audioRef.current?.pause();
    stopClipTimers();
    clockRef.current.close(Date.now());
    setClipPaused(false);
  }, [stopClipTimers]);

  /**
   * Hand back the clip the element is holding, so a round cannot inherit the
   * previous round's URL. `handleAudioError` already documented this as
   * something that happens between rounds; until now nothing did it, and the
   * only reason a stale src was never heard is that the replay controls happen
   * not to render outside "playing"/"guessing" — one render condition away from
   * being audible. Round teardown only: reveal() also stops the clip, and replay
   * has to keep working after it.
   *
   * removeAttribute rather than `src = ""`, which resolves against the document
   * and would leave the element holding the page's own URL.
   */
  const releaseClip = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.removeAttribute("src");
    audio.load();
  }, []);

  /**
   * End the round the host is looking at: stop the clip, retire everything
   * still in flight for it, hand the element back, and clear the affordances
   * that belong to a round being loaded.
   *
   * One function rather than three lines at each call site, because the failure
   * mode of forgetting the token bump is precisely the bug this exists to fix,
   * and a fourth round-ending path is exactly the kind of thing that gets added
   * later. Nothing can test that ordering — the guard lives in a component the
   * vitest suite cannot reach — so it has to be impossible to get wrong instead.
   *
   * The first clip is settled first, while the press it belongs to can still
   * be told from the next round's: a host who skips past a clip that never
   * started has abandoned it, and that is the outcome.
   */
  const retireRound = useCallback(() => {
    settleFirstClip("abandoned");
    stopClip();
    roundsRef.current.bump();
    releaseClip();
    endBusy();
    setClipMiss(null);
    setPlayBlocked(false);
  }, [settleFirstClip, stopClip, releaseClip, endBusy]);

  /**
   * Start (or restart) the progress bar and the end-of-clip deadline for
   * however much of the clip is left.
   *
   * **Called when the element reports sound, never when it is asked for.**
   * That is the whole of `soundStarted` below and the reason it exists: these
   * used to start on the line after `play()`, so a refused or still-loading
   * clip counted its window down over silence.
   */
  const startClipTimers = useCallback(() => {
    stopClipTimers();
    const totalMs = clipDuration * 1000;
    const clock = clockRef.current;
    clock.open(Date.now());
    progressIntervalRef.current = setInterval(() => {
      setProgress(Math.min((clock.elapsed(Date.now()) / totalMs) * 100, 100));
    }, 80);
    clipTimeoutRef.current = setTimeout(() => {
      audioRef.current?.pause();
      stopClipTimers();
      // Bank the whole clip, so a later Resume knows the window is spent and
      // plays on instead of re-arming a countdown that already finished.
      clock.spend(totalMs);
      setProgress(100);
      setPhase("guessing");
    }, Math.max(0, totalMs - clock.elapsed(Date.now())));
  }, [clipDuration, stopClipTimers]);

  /**
   * The element is making sound. The only place a clip's timers start and the
   * only place a round becomes "playing".
   *
   * Reached twice for most clips — the promise `play()` returned resolves and
   * the `playing` event fires, for the same fact — and the request is what
   * makes the second a no-op. Both are listened to because neither is
   * universal: a browser old enough to return no promise has only the event.
   * A `playing` with no request is one nobody asked for (the element picking
   * up after a stall), and it must not restart a countdown.
   */
  const soundStarted = useCallback(() => {
    const request = soundRequestRef.current;
    if (!request) return;
    soundRequestRef.current = null;

    const verdict = afterSoundStarted({
      phase: phaseRef.current,
      currentRound: request.stillThisRound(),
      windowSpent: clockRef.current.elapsed(Date.now()) >= clipDuration * 1000,
    });
    if (verdict === "silence") {
      audioRef.current?.pause();
      return;
    }

    endBusy();
    settleFirstClip("played");
    setClipPaused(false);
    if (verdict === "play_on") {
      clockRef.current.open(Date.now());
      return;
    }
    startClipTimers();
    setPhase("playing");
  }, [clipDuration, endBusy, settleFirstClip, startClipTimers]);

  /**
   * Ask the element for sound, and do nothing else until it answers.
   *
   * Every `play()` on this page goes through here; there were four, each
   * `audio.play().catch(() => {})` with the phase and the timers set on the
   * next line. A request replaces the one before it, so an answer that
   * arrives for a request no longer in the ref — Replay tapped twice, a
   * repair that overtook the start it is repairing — belongs to nobody.
   */
  const requestSound = useCallback(
    (site: ClipSite) => {
      const audio = audioRef.current;
      if (!audio) return;
      const request: SoundRequest = { site, stillThisRound: roundsRef.current.begin() };
      soundRequestRef.current = request;
      setPlayBlocked(false);

      void startPlayback(audio).then((result: PlaybackResult) => {
        const standing = soundRequestRef.current === request;
        if (result === "pending") return;
        if (result === "sounding") {
          if (standing) soundStarted();
          return;
        }

        const verdict = afterPlayRejected({
          result,
          phase: phaseRef.current,
          currentRound: request.stillThisRound(),
          standing,
        });
        // `unplayable` leaves the request where it is: the element fires
        // `error` for the same fault, and handleAudioError reads the request
        // to know this round was waiting on a clip.
        if (verdict.act === "ignore") return;

        soundRequestRef.current = null;
        stopClipTimers();
        clockRef.current.close(Date.now());
        endBusy();
        settleFirstClip("rejected");
        trackEvent("clip_blocked", {
          site,
          reason: result === "interrupted" ? "interrupted" : "refused",
          round_index: currentIndexRef.current + 1,
        });
        setClipPaused(false);
        setPlayBlocked(true);
        setPhase(verdict.phase);
      });
    },
    [soundStarted, stopClipTimers, endBusy, settleFirstClip]
  );

  /**
   * Hold the music where it is, without ending the round. Someone buzzing in is
   * the usual trigger: the music gets out of the way so the room can hear the
   * answer, and a wrong answer can hand the rest of the clip back.
   *
   * Available for as long as the host is still running the round — through
   * "playing" and on into "guessing", where the clip's own window has elapsed
   * but the host may well still be playing the song while people think. Only
   * revealing the answer ends it.
   */
  const pauseClip = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    if (phaseRef.current !== "playing" && phaseRef.current !== "guessing") return;
    // Same order as stopClip, same reason: a Replay still loading when the
    // buzz lands has a play() pending, and this pause is what rejects it.
    soundRequestRef.current = null;
    audio.pause();
    clockRef.current.close(Date.now());
    stopClipTimers();
    setClipPaused(true);
  }, [stopClipTimers]);

  /**
   * Hand the rest of the clip back. Whether there is any of it left to count
   * down — or the host is deliberately playing on past the window — is
   * decided when the sound starts, by `afterSoundStarted`, not here.
   */
  const resumeClip = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    requestSound("resume");
  }, [requestSound]);

  /** Stop the music and ask the room. The clip stays resumable. */
  const holdClip = useCallback(() => {
    pauseClip();
    setPhase("guessing");
  }, [pauseClip]);

  /** Start the clip over from the top. */
  const replayClip = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    stopClipTimers();
    clockRef.current.reset();
    audio.currentTime = 0;
    setProgress(0);
    requestSound("replay");
  }, [stopClipTimers, requestSound]);

  /**
   * The waiting-phase Play button, and Retry, which is the same press asked
   * again. Both are taps in the waiting phase of the round on screen, which
   * is the only thing the guards below assume.
   */
  async function playClip() {
    const audio = audioRef.current;
    const track = tracks[currentIndex];
    if (!audio || !track) return;
    const stillThisRound = roundsRef.current.begin();

    // Whatever the prefetch resolved. There is no Spotify URL to prefer here:
    // preview_url has been null for every track since Nov 2024, so the clip
    // always comes from iTunes or Deezer via lib/preview-cache.ts.
    const cached = previewCache.current[track.id];
    let previewUrl = cached ?? null;
    let missReason: ClipMiss = "absent";

    // Armed by the first press of the page and by no other — see the tracker.
    firstClipRef.current.press(firstClipPath(cached));
    setClipMiss(null);
    setPlayBlocked(false);
    // One wait from the tap to the sound, whichever of the two steps below
    // it is spent in. The prefetched path shows it too, for as long as the
    // element takes to load — which is the honest thing to show.
    beginBusy();

    // `undefined` means nobody has asked yet. A cached `null` is a settled
    // "nothing anywhere has a clip for this", and re-asking it on every press
    // of Play is the load the cache exists to remove.
    if (!previewUrl && cached === undefined) {
      const result = await fetchPreview({
        id: track.id,
        name: track.name,
        artist: track.artists[0] ?? "",
        durationMs: track.durationMs,
      });
      // Keyed by track id, so it is worth keeping whichever round we came back
      // to — the host who skipped past this track may still come back to it.
      // Settled answers only — see previewCache's declaration.
      if (isPreviewSettled(result.status)) previewCache.current[track.id] = result.previewUrl;

      // The host moved on while we were asking. Everything past here writes to
      // state and to an element that now belong to somebody else's round —
      // the loading affordances included: retireRound has already put ours
      // away, and the spinner on screen now may be the next round's.
      if (!stillThisRound()) return;

      // The round does not have to *end* for the answer to be stale. "Reveal
      // Answer" is rendered by this very loading state, and reveal() only moves
      // the phase — so without this the clip started under the answer card the
      // host had just put up, tearing the scoring buttons off screen. playClip
      // is only ever called from the waiting phase, so a resolution landing in
      // any other can never legitimately start a clip. reveal() has put the
      // spinner away itself.
      if (phaseRef.current !== "waiting") return;

      previewUrl = result.previewUrl;
      missReason = result.status === "unavailable" ? "unavailable" : "absent";
    }

    if (!previewUrl) {
      trackEvent("preview_miss", {
        playlist_source: playlistSource,
        track_name: track.name,
        artist: track.artists[0] ?? "",
        reason: missReason,
      });
      endBusy();
      settleFirstClip(missReason === "unavailable" ? "unavailable" : "no_audio");
      setClipMiss(missReason);
      return;
    }

    audio.src = previewUrl;
    audio.currentTime = 0;
    clockRef.current.reset();
    setProgress(0);
    setClipPaused(false);
    // The phase stays "waiting" and no timer starts. On the lazy path this
    // play() is already outside the tap that asked for it, which is where a
    // browser may refuse it; soundStarted and the rejection in requestSound
    // are the two ways this round leaves the spinner.
    requestSound("play");
  }

  /**
   * The clip cannot be played and there is nothing left to try. Put the
   * round into the state a track with no clip starts in, rather than leaving
   * a spinner, or a progress bar, over silence.
   */
  function clipFailed(miss: ClipMiss) {
    stopClip();
    endBusy();
    settleFirstClip("error");
    setClipMiss(miss);
    setPhase("waiting");
  }

  /**
   * Repair a preview URL that stopped playing.
   *
   * Preview clips sit on a CDN that rotates its URLs, so a cached hit can go
   * dead long before the server's copy of it expires. That is the trade the
   * year-long positive TTL makes, and this is the other half of it: one
   * `lookup?id=` call re-resolves the track, where letting the entry expire
   * instead would mean re-searching every song in the catalogue on a timer.
   *
   * Once per track per game. A URL that fails twice is not a rotated one —
   * and a second failure ends the round's clip rather than being ignored,
   * which is what it used to be: the early return left whatever was on
   * screen counting down over an element that could no longer make a sound.
   */
  async function handleAudioError() {
    const audio = audioRef.current;
    const track = tracks[currentIndex];
    if (!audio || !track) return;
    // Is this round waiting on the element at all? Read as a function because
    // it is asked twice, either side of the await, and the second answer is
    // the one that counts.
    const verdictNow = () =>
      afterClipError({
        // The element also fires `error` when we clear its src between
        // rounds, which is us tearing the round down, not a URL going bad.
        hasSource: Boolean(audio.src),
        phase: phaseRef.current,
        starting: soundRequestRef.current !== null,
        repairing: repairingRef.current === track.id,
        alreadyRepaired: refreshedTracks.current.has(track.id),
      });

    const verdict = verdictNow();
    if (verdict === "ignore") return;
    // Whatever was counting, the sound it was counting has stopped.
    stopClipTimers();
    clockRef.current.close(Date.now());
    if (verdict === "give_up") {
      clipFailed("absent");
      return;
    }

    repairingRef.current = track.id;
    const stillThisRound = roundsRef.current.begin();
    const result = await fetchPreview(
      { id: track.id, name: track.name, artist: track.artists[0] ?? "", durationMs: track.durationMs },
      { refresh: true }
    );
    // Ours to clear only if it is still ours: the host may have skipped onto
    // a track that is being repaired in its own right.
    if (repairingRef.current === track.id) repairingRef.current = null;
    // An `unavailable` repair is a repair that was never made — the refresh
    // route has its own, much tighter limit — so it does not spend the
    // track's one attempt: Retry replays the dead URL, lands back here, and
    // has to be allowed to ask.
    if (result.status !== "unavailable") refreshedTracks.current.add(track.id);

    // Same rule as playClip, and the reason the guard above is not enough: it
    // was read before the await. A repair that lands after the host has moved
    // on would put the previous round's clip on this round's card.
    if (!stillThisRound()) {
      if (result.previewUrl) previewCache.current[track.id] = result.previewUrl;
      return;
    }
    // Reveal moves the phase without ending the round, and a repair can land
    // up to UPSTREAM_TIMEOUT_MS later: without this it either starts the clip
    // under the answer card, or — on the failure branch — puts the phase back
    // to "waiting" and takes the whole scoring card with it.
    if (verdictNow() === "ignore") {
      if (result.previewUrl) previewCache.current[track.id] = result.previewUrl;
      return;
    }

    if (!result.previewUrl) {
      clipFailed(result.status === "unavailable" ? "unavailable" : "absent");
      return;
    }

    previewCache.current[track.id] = result.previewUrl;
    audio.src = result.previewUrl;
    audio.currentTime = 0;
    // From the top, so the room gets a whole clip of the repaired one.
    clockRef.current.reset();
    setProgress(0);
    // After an await, so outside any tap: the other play() a browser may
    // refuse. A refusal puts the host at a button, with the URL now cached.
    requestSound("repair");
  }

  function reveal() {
    // A press still waiting on its clip when the answer goes up came to
    // nothing, and nothing after this will answer it: stopClip drops the
    // request, so the spinner it was holding has to be put away here.
    settleFirstClip("abandoned");
    endBusy();
    setPlayBlocked(false);
    stopClip();
    // Deliberately does NOT resolve the room's round.
    //
    // Revealing is when the host *starts* scoring, not when they finish: the
    // answer goes up, then they say who got it. The room only accepts a verdict
    // while the round is "locked", so resolving here made the Correct and Wrong
    // buttons on the next screen silent no-ops — the queue never advanced and
    // the phones never heard the outcome. The round closes when the host
    // actually calls it: correct(), or next() — which sends reveal() first
    // when nobody scored, see nextTrack().
    setPhase("revealed");
  }

  /**
   * The scoreboard follows whoever actually joined the room.
   *
   * Two name spaces used to drift apart: names typed at setup (or pulled from
   * Mixed Playlist contributors) fed the scoreboard, while names typed on each
   * phone fed the room. awardPoint matches by name, so anyone whose phone name
   * didn't exactly match their setup name scored nothing, silently.
   *
   * Additive only — a player who drops out keeps the points they earned.
   *
   * The merge itself lives in game-session so it can be unit-tested without a
   * room; it also matches names case-insensitively, which this callback used to
   * get wrong. The room refuses a second "amy" while "Amy" is connected, so the
   * two spellings are one player reconnecting, not two rows on the scoreboard.
   */
  const mergeRoomPlayers = useCallback((names: string[]) => {
    setPlayers((prev) => mergeRoomRoster(prev, names));
  }, []);

  function awardPoint(requested: string) {
    if (pointsAwarded) return;
    // A buzz carries the phone's spelling; the row keeps the scoreboard's.
    const playerName = scoreboardName(players, requested);
    if (playerName === null) return;
    setRoundWinner(playerName);
    setPointsAwarded(true);
    setScorePulse(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + 3 } : p))
    );
    setTimeout(() => setScorePulse(null), 600);
  }

  function awardAlbumPoint(requested: string) {
    if (albumPointsAwarded) return;
    // A buzz carries the phone's spelling; the row keeps the scoreboard's.
    const playerName = scoreboardName(players, requested);
    if (playerName === null) return;
    setAlbumWinner(playerName);
    setAlbumPointsAwarded(true);
    setScorePulse(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + 1 } : p))
    );
    setTimeout(() => setScorePulse(null), 600);
  }

  /** Mixed Playlist Mode: +2 for guessing whose playlist the track came from. */
  function awardSourcePoint(requested: string) {
    if (sourcePointsAwarded) return;
    // A buzz carries the phone's spelling; the row keeps the scoreboard's.
    const playerName = scoreboardName(players, requested);
    if (playerName === null) return;
    setSourceWinner(playerName);
    setSourcePointsAwarded(true);
    setScorePulse(playerName);
    setPlayers((prev) =>
      prev.map((p) => (p.name === playerName ? { ...p, score: p.score + 2 } : p))
    );
    setTimeout(() => setScorePulse(null), 600);
  }

  /**
   * Fire game_finished exactly once (guards endGame + nextTrack double entry).
   * `endedEarly` is the caller's to say: End Game before the last reveal is
   * early; the last track ending — played out or skipped — is not.
   */
  function trackGameFinished(endedEarly: boolean) {
    if (finishedTrackedRef.current) return;
    finishedTrackedRef.current = true;
    const roundsPlayed = countRoundsPlayed(currentIndex, phase);
    // The KV copy, under the same once-per-game guard so the two cannot
    // disagree. `Games started` minus this is the tab that closed mid-party.
    // The layout is read here, in the click, rather than from `screen`: it
    // names the screen this tap is about to draw.
    const layout = readGameScreen();
    reportGameEnd(endedEarly ? "ended_early" : "played_out", roundsPlayed, {
      host: hostKindRef.current,
      ...(layout ? { screen: layout } : {}),
      ...(setupSourceRef.current ? { source: setupSourceRef.current } : {}),
      mode,
    });
    trackEvent("game_finished", {
      rounds_played: roundsPlayed,
      total_tracks: tracks.length,
      duration_seconds: Math.round((Date.now() - gameStartTimeRef.current) / 1000),
      playlist_source: playlistSource,
      game_mode: mode,
      ended_early: endedEarly,
      host_kind: hostKindRef.current,
      ...(silentSkipped > 0 ? { silent_skipped: silentSkipped } : {}),
      // The reach denominator: how many phones this game actually touched.
      // Only meaningful in buzzer mode, so it's omitted elsewhere rather than
      // reported as 0 and dragging the average down.
      ...(buzzerRoom ? { peak_phone_count: peakPhonesRef.current } : {}),
    });
  }

  function nextTrack() {
    // The song row's "No one" button used to tell the room that nobody scored
    // (host:reveal, so the phones hear the round is over and the analytics
    // count a round nobody got). Pressing Next Track is how a host says that
    // now, so the same message goes out here, under exactly the conditions
    // that button used to render: the answer is up, nothing has been awarded,
    // and no buzz is waiting on a verdict.
    const room = buzzerControlsRef.current;
    if (room && announcesNoScore({ phase, pointsAwarded, buzzesPending: room.buzzes.length })) {
      room.reveal();
    }
    retireRound();
    room?.next();
    trackEvent("round_completed", {
      round_index: currentIndex + 1,
      skipped: phase !== "revealed",
      playlist_source: playlistSource,
    });

    recordRound("next");

    if (currentIndex + 1 >= tracks.length) {
      trackGameFinished(false);
      setPhase("finished");
    } else {
      // The ref moves with the state rather than a render behind it: the
      // prefetch's answer reads it to decide which tracks are still upcoming,
      // and the track that has just become current must not be one of them.
      currentIndexRef.current = currentIndex + 1;
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
    }
  }

  // Both round-closing paths go through here; the rule is closeRoundEntry.
  function recordRound(via: "next" | "end") {
    const entry = closeRoundEntry({
      track: tracks[currentIndex],
      revealed: phase === "revealed",
      songWinner: roundWinner,
      albumWinner,
      sourceWinner,
      via,
    });
    if (entry) setRoundHistory((prev) => [...prev, entry]);
  }

  function endGame() {
    retireRound();
    recordRound("end");
    trackGameFinished(currentIndex + 1 < tracks.length || phase !== "revealed");
    setPhase("finished");
  }

  function playAgain() {
    reportGameOverTap("play_again", screen);
    router.push("/");
  }

  /**
   * The phone's way onward from Game Over. A real `href`, so the link can be
   * long-pressed and opened like one, routed client-side on a plain tap so
   * the document — and the beacon just handed to it — survives.
   */
  function openMixedSetup(event: ReactMouseEvent<HTMLAnchorElement>) {
    reportGameOverTap("mixed", screen);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.push(MIXED_SETUP_HREF);
  }

  /**
   * Put the merged tracklist on the clipboard.
   *
   * The failure path shows the text instead of silently doing nothing: clipboard
   * access is refused often enough (insecure context, Safari outside a user
   * gesture, a locked-down work phone) that a button which sometimes no-ops
   * teaches the host it is broken. A selectable block still gets the list to the
   * group chat, which is the whole point of the button.
   */
  async function copyMixList() {
    const text = formatMixList({
      // The pool, not the queue — see `pool`'s declaration.
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
    // The pool, not the queue: a shared banger with no clip is still shared.
    const tasteCard = buildTasteCard(pool, roundHistory);
    const W = 640;
    const sharedTracks = tasteCard.sharedTracks.slice(0, 5);
    const sharedRowH = 44;
    const headerH = 200;
    const sharedSectionH =
      sharedTracks.length > 0 ? 40 + sharedTracks.length * sharedRowH + 20 : 0;
    const awardCount = (tasteCard.mostObscure ? 1 : 0) + (tasteCard.mostMainstream ? 1 : 0);
    // Zero awards means zero height, matching how `sharedSectionH` above is
    // computed. Without this the card reserved room for a heading it then drew
    // over nothing: both awards are absent exactly when a room shares no taste
    // and carries no popularity data, which is the cross-culture case this card
    // is most likely to be saved from.
    const awardsSectionH = awardCount > 0 ? 40 + awardCount * 70 + 20 : 0;
    const footerH = CARD_FOOTER_HEIGHT;
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

    if (awardCount > 0) {
      ctx.fillStyle = "#1DB954";
      ctx.font = "bold 13px sans-serif";
      ctx.letterSpacing = "1px";
      ctx.fillText("AWARDS", 40, y + 24);
      y += 40;
    }

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
  // Null on an empty history, so an abandoned or non-mixed game renders nothing
  // rather than a sentence made of zeroes.
  const roundSummaryLine = describeRounds(summarizeRounds(roundHistory));
  const maxScore = sortedPlayers[0]?.score ?? 0;
  const skippedLine = silentSkippedLine(silentSkipped);
  const onward = gameOverOnward(screen);

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
        /* A drag past the top of the card is Android's pull-to-refresh, and a
           refresh here is round one with the scores wiped: the game payload
           in sessionStorage is the setup, not the progress. Refused on the
           root and on the scroller so the gesture has nowhere to chain to. */
        html, body { overscroll-behavior-y: none; }

        /* Phones. Every control below has a :active rule, so the grey flash
           a touch browser lays over a tapped element is noise on top of it;
           touch-action: manipulation stops two quick taps on Next Track
           from being read as double-tap-to-zoom; and nothing on this screen
           is prose, so a long press should not start selecting it. Hover rules are behind
           (hover: hover) throughout, because a tap on a touch screen leaves
           :hover applied until the next tap lands somewhere else. */
        button, a { -webkit-tap-highlight-color: transparent; }
        button { touch-action: manipulation; -webkit-user-select: none; user-select: none; }

        /* One corner radius for every button, control and surface on this
           screen. It used to be five values picked per element (8, 10, 12, 14,
           20) plus 999px pills for the player picker, which read as sloppy the
           moment two of them sat side by side — the picker sits directly under
           the Correct/Wrong row, so the mismatch was unmissable.
           Only the circular avatar (50%) and the 2px progress hairline are
           exempt: those are shapes, not corner-radius choices. */
        :root { --radius: 12px; }

        .game-layout {
          display: grid;
          grid-template-rows: 56px minmax(0, 1fr);
          /* minmax(0, 1fr), not 1fr. A bare 1fr is minmax(auto, 1fr), and
             auto lets the column grow to the widest thing in it, which is
             the top bar's one-line contents: round badge, playlist name,
             End Game. On a 390px phone that came to 435px, so the whole
             game ran 45px past the right edge, End Game was half a button
             and the scoreboard's numbers were off screen, and the
             overflow: hidden above meant nothing could be scrolled into
             view. Longer playlist names made it worse. */
          grid-template-columns: minmax(0, 1fr) 300px;
          height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #111;
        }
        /* Trial mode: no sidebar, main area takes the full width */

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
          /* min-width: 0 is what lets the ellipsis happen inside the flex
             row instead of the row growing to fit the name. */
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .round-badge, .end-game-btn { flex-shrink: 0; }

        /* MAIN AREA */
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
          border-radius: var(--radius);
          padding: 28px;
          backdrop-filter: blur(20px);
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }

        /* Album art */
        .album-wrap {
          width: 100%;
          aspect-ratio: 1;
          border-radius: var(--radius);
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
          /* The blur is CSS. A long press on iOS opens the image callout,
             which previews the file as it is: the answer, in a sheet, in the
             middle of the guessing. The overlay takes every tap anyway. */
          pointer-events: none;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
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
        @media (hover: hover) { .play-btn:hover { transform: scale(1.06); box-shadow: 0 0 56px rgba(29,185,84,0.7); } }
        .play-btn:active { transform: scale(0.97); transition: none; }
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
          border-radius: var(--radius);
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
        /* Three buttons do not fit one row on a phone: the card is 330px
           inside at 390 wide, and "Reveal Answer" alone needs 150 of it, so
           it wrapped to two lines beside the other two. Reveal takes the
           first row and Retry and Skip share the second, at every width, so
           the row a host learned on a laptop is the row on their phone. */
        .btn-row.with-retry { flex-wrap: wrap; }
        .btn-row.with-retry .btn-primary { flex: 1 1 100%; }
        .btn-row.with-retry .btn-ghost { flex: 1 1 0; }

        /* One quiet line under the Play prompt. The blocked variant is the
           one the host has to act on, so it is the one that is legible
           across a room. */
        .clip-note { margin-top: 8px; font-size: 12px; line-height: 1.4; color: #555; text-align: center; }
        .clip-note.blocked { margin-top: 0; font-size: 14px; font-weight: 500; color: #e8e8e8; }

        .btn-primary {
          flex: 1;
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
        /* Pressed states land on touchstart — transition: none here, so
           the eased transition on the base rule only runs on release; with
           it on both ends an 80ms tap let go before the 150ms ease arrived
           and the press read as a flicker. */
        .btn-primary:active { transform: scale(0.98); transition: none; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

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
        .btn-ghost.compact:disabled { cursor: default; }
        .btn-ghost.compact.used { color: #1DB954; border-color: rgba(29,185,84,0.5); opacity: 0.7; }

        /* Playing / guessing: Reveal on top, everything else in one quiet row */
        .clip-controls { display: flex; flex-direction: column; gap: 8px; }
        .clip-controls .btn-primary { flex: none; width: 100%; }
        .clip-secondary { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }

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
        .player-pick-btn.picked { background: #1DB954; border-color: #1DB954; color: #000; }
        .player-pick-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .player-pick-btn.compact { padding: 8px 12px; min-height: 32px; font-size: 12px; font-weight: 500; color: #999; }

        /* Bonus rows (album, whose playlist): one line, label then chips */
        .score-row-compact {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-bottom: 12px;
        }
        .score-row-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #999;
          /* Its own line, so five players' chips never orphan it. */
          flex-basis: 100%;
          margin-right: 4px;
          white-space: nowrap;
        }
        .score-row-done { font-size: 12px; color: #1DB954; }

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
          padding: 28px 24px calc(24px + env(safe-area-inset-bottom));
          animation: fade-in 0.4s ease;
          /* Scrolls once the scoreboard has given way to its floor: on a
             short phone with the install card and the mix fallback both up,
             everything else refuses to shrink and the board went to 0px. */
          overflow-x: hidden;
          overflow-y: auto;
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

        /* Quiet on purpose. This is a description of the evening, not a result,
           and it sits directly under a scoreboard that already has the room's
           attention. */
        .round-summary {
          color: #666;
          font-size: 13px;
          text-align: center;
          margin: 4px 0 0;
          flex-shrink: 0;
          max-width: 480px;
        }

        /* Wraps rather than scrolls horizontally, because the point is to
           select all of it. */
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
          /* Focusable (it selects itself on focus), so the 16px floor from
             components/setup-chrome.tsx applies: smaller and iOS zooms the
             final screen into it. */
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

        /* The phone's way onward from Game Over, where the desktop has the
           QR. A link and not a button: it goes somewhere, and it is the
           quietest thing on the screen by design, under a primary and a row
           of ghosts. 44px tall because it is tapped with a thumb, and free
           to wrap because the sentence is 48 characters and a 360px phone
           has room for about 44 of them. */
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

        .install-cta {
          width: 100%;
          max-width: 480px;
          display: flex;
          align-items: center;
          gap: 14px;
          background: rgba(29,185,84,0.06);
          border: 1px solid rgba(29,185,84,0.25);
          border-radius: var(--radius);
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
          border-radius: var(--radius);
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        @media (hover: hover) { .install-cta-btn:hover { background: #1ed760; transform: translateY(-1px); } }
        .install-cta-btn:active { transform: scale(0.97); transition: none; }

        /* PHONES. The host's phone is a remote control: whatever the round
           needs next sits under the thumb without a scroll, and the room's
           standings are a glance, not a panel. Three things had to give for
           that, all measured on a 390×844 viewport.

           The album art. Full-width it was 270px of a 648px main area, and
           the reveal (title, artist, who-scored, the picker, the album row,
           Next Track) ran to 807px, so Next Track was below the fold every
           round. Sized to the viewport's height now, so it shrinks on a
           short phone before the controls do.

           The scoreboard. A 140px list under the card showed two of four
           players and cost the reveal its last button. It is one row of
           chips now, ranked left to right, scrolling sideways when the room
           is bigger than the screen. Same markup; the rank, name and score
           are still there.

           The paddings. 32px around the card and 28px inside it were desktop
           breathing room; at 390px wide that was 120px of the width spent
           on nothing. */
        @media (max-width: 768px) {
          .game-layout {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: 56px minmax(0, 1fr) auto;
          }
          .top-bar { padding: 0 14px; }
          .playlist-name { max-width: none; flex: 1; text-align: center; }
          .end-game-btn { font-size: 11px; padding: 8px 12px; min-height: 40px; }

          /* The card stays top-anchored in every phase, waiting included,
             where its one control sits high on the screen: the art is the
             game's face there, and a card that moved between phases would
             move Reveal and Next Track with it. */
          .main-area { padding: 14px 14px 20px; }
          .game-card { padding: 18px 16px 16px; }
          /* Up to full width while the room is guessing — the blurred
             square with the play button in it is the game's face, and the
             card under it is short — sized by the viewport's height and
             capped at 340px, so a short phone gets smaller art before the
             reveal too. At the reveal it collapses to a smaller share, and
             the title, picker and Next Track take the room it gives back:
             the art gives way before the controls do. The collapse is a
             cut, not a transition: animating width
             reflows the whole card for every frame, on top of the un-blur
             that is already running, and a phone GPU drops frames on both. */
          /* Each width twice: a browser without dvh (iOS before 15.4, older
             webviews) drops the whole declaration, and without the vh line
             first the art would stay at the base width: 100% in every phase
             — the old layout back, silently. */
          .album-wrap {
            width: min(100%, clamp(180px, 42vh, 340px));
            width: min(100%, clamp(180px, 42dvh, 340px));
            margin: 0 auto 14px;
          }
          .album-wrap.revealed {
            width: min(100%, clamp(140px, 27vh, 240px));
            width: min(100%, clamp(140px, 27dvh, 240px));
          }
          /* A short phone (an iPhone SE is 667px) has ~560px for the card at
             the reveal and the controls alone need 435 of it, so the art is
             a thumbnail there: the answer is the title, and the art has
             already had its moment. */
          @media (max-height: 700px) {
            .album-wrap.revealed {
              width: min(100%, clamp(110px, 18vh, 240px));
              width: min(100%, clamp(110px, 18dvh, 240px));
            }
          }
          .play-btn { width: 76px; height: 76px; }
          .progress-wrap { margin-bottom: 14px; }
          .track-reveal { padding: 0 0 12px; }
          .track-name { font-size: clamp(26px, 7.5vw, 34px); }

          /* Thumb-sized. 44px is the floor for anything tapped once per
             round; the bonus chips are tapped less and read as secondary
             at 36px. */
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
            /* Snaps to a whole chip when a scroll ends near one — proximity,
               not mandatory, so the strip still scrolls freely. */
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
          /* The sidebar's greys were tuned for #0e0e0e; on the chip's
             #161616 the rank vanished and the score, the chip's payload,
             sat under 3:1. Lifted to read across a dim room. */
          .rank-num { width: auto; color: #666; }
          .player-name-score { font-size: 13px; max-width: 120px; }
          .score-chip { font-size: 18px; line-height: 1; color: #aaa; }

          /* Fixed to the viewport, so body's side insets (app/globals.css)
             do not reach it: it pads for the landscape notch itself. */
          .finished-overlay {
            padding:
              20px
              max(16px, env(safe-area-inset-right))
              calc(16px + env(safe-area-inset-bottom))
              max(16px, env(safe-area-inset-left));
          }
        }
      `}</style>

      {/* `playing`, not `play`: `play` fires when the element is asked, and
          `playing` when there is sound. The round waits for the second. */}
      <audio
        ref={audioRef}
        onPlay={() => setAudioPlaying(true)}
        onPlaying={soundStarted}
        onPause={() => setAudioPlaying(false)}
        onEnded={() => setAudioPlaying(false)}
        onError={handleAudioError}
      />

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
          <span className="playlist-name">{playlistName}</span>
          {/* One exit, not two. End Game goes to the final scores, and the
              scores screen is where "Play Again" leads home — a second button
              that dropped the host on "/" with no confirmation lost whole
              games to a mis-tap. */}
          {phase !== "finished" && (
            <button className="end-game-btn" onClick={endGame}>
              End Game
            </button>
          )}
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
            {/* Album art. `revealed` is read by the phone layout, which
                collapses the art at the reveal to make room for the scoring
                controls under it. */}
            <div className={`album-wrap${isRevealed ? " revealed" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={showAlbumArt ? albumArt : ALBUM_PLACEHOLDER}
                alt="Album art"
                className={`album-img${isRevealed ? " revealed" : showAlbumArt ? " blurred" : " blurred"}`}
                draggable={false}
              />
              {/* Play button overlay */}
              {phase === "waiting" && !clipMiss && (
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
              {/* No audio overlay. Two sentences, because they are two facts:
                  the song has no clip, or we could not fetch one. */}
              {phase === "waiting" && clipMiss && (
                <div className="album-overlay" style={{ background: "rgba(0,0,0,0.75)", flexDirection: "column", gap: "8px" }}>
                  <p style={{ color: "#999", fontSize: "13px", textAlign: "center", padding: "0 16px" }}>
                    {clipMiss === "unavailable" ? CLIP_COPY.unavailable : CLIP_COPY.absent}
                  </p>
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

            {/* Buzzer Mode: the room code, the queue, and the host's verdict
                buttons. Rendered above the phase content so the host's eyes and
                thumb stay in one place all game. Absent unless a room was
                created at setup, so party games are untouched. */}
            {buzzerRoom && phase !== "finished" && (
              <BuzzerHostPanel
                roomCode={buzzerRoom.code}
                hostToken={buzzerRoom.hostToken}
                hostName={buzzerRoom.hostName}
                roundIndex={currentIndex}
                gamePhase={phase}
                onControls={setBuzzerControls}
                onBuzz={pauseClip}
                onPlayersChange={mergeRoomPlayers}
                onPeakPlayers={(n) => {
                  peakPhonesRef.current = n;
                }}
              />
            )}

            {/* Phase content */}
            {phase === "waiting" && (
              <div style={{ textAlign: "center" }}>
                {previewLoading ? (
                  <div>
                    <p style={{ color: "#1DB954", fontSize: "13px", letterSpacing: "0.06em", marginBottom: "12px" }}>
                      Finding audio…
                    </p>
                    {loadingSkipVisible && skipControls()}
                  </div>
                ) : clipMiss ? (
                  skipControls()
                ) : playBlocked ? (
                  <p className="clip-note blocked" role="status">
                    {CLIP_COPY.blockedPlay}
                  </p>
                ) : (
                  <>
                    <p style={{ color: "#555", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Press Play to start the clip
                    </p>
                    {skippedLine && <p className="clip-note">{skippedLine}</p>}
                  </>
                )}
              </div>
            )}

            {phase === "playing" && (
              <div>
                <p className="listening-label" style={{ marginBottom: "12px" }}>
                  {clipPaused ? "Paused — someone buzzed in" : "Listening…"}
                </p>
                {clipControls()}
              </div>
            )}

            {phase === "guessing" && (
              <div>
                <p style={{ textAlign: "center", fontSize: "20px", fontWeight: 600, color: "#f0f0f0", marginBottom: "12px" }}>
                  What&apos;s the song?
                </p>
                {/* A refused Resume, Replay or repair lands here rather than
                    in "playing": the transport below it shows Resume, which
                    is the tap the line asks for. */}
                {playBlocked && (
                  <p className="clip-note blocked" role="status" style={{ marginBottom: "12px" }}>
                    {CLIP_COPY.blockedResume}
                  </p>
                )}
                {clipControls()}
              </div>
            )}

            {phase === "revealed" && (
              <div>
                <div className="track-reveal">
                  <p className="track-name">{currentTrack?.name}</p>
                  <p className="track-artist">{currentTrack?.artists?.join(", ")}</p>
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

                {/* Song scoring — 3 pts. In Buzzer Mode the room already knows
                    who got there first, so listing every player again would be
                    asking the host to re-answer a question the server settled.
                    Falls back to the full picker when nobody buzzed. */}
                {buzzerControls && buzzerControls.buzzes.length > 0 && !pointsAwarded ? (
                  <>
                    <p className="who-scored">
                      {buzzerControls.buzzes[0].name} buzzed first —{" "}
                      {(buzzerControls.buzzes[0].msSinceOpen / 1000).toFixed(2)}s
                    </p>
                    {/* Centred and content-sized, both of them. .btn-primary is
                        flex:1 by default, so next to a content-sized "Wrong" the
                        Correct button ballooned across the card and read as a
                        different class of control than the verdict beside it. */}
                    <div
                      className="btn-row"
                      style={{ marginBottom: "14px", justifyContent: "center" }}
                    >
                      <button
                        className="btn-primary"
                        style={{ flex: "0 0 auto", padding: "12px 16px" }}
                        onClick={() => {
                          awardPoint(buzzerControls.buzzes[0].name);
                          buzzerControls.correct();
                        }}
                      >
                        Correct +3
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => buzzerControls.wrong()}
                        style={{ flex: "0 0 auto" }}
                      >
                        {buzzerControls.buzzes.length > 1
                          ? `Wrong → ${buzzerControls.buzzes[1].name}`
                          : "Wrong"}
                      </button>
                    </div>
                    {buzzerControls.buzzes.length > 1 && (
                      <p style={{ textAlign: "center", fontSize: "12px", color: "#666", marginBottom: "14px" }}>
                        Queue: {buzzerControls.buzzes.slice(1).map((b) => b.name).join(" → ")}
                      </p>
                    )}
                  </>
                ) : !pointsAwarded ? (
                  <>
                    <p className="who-scored">Who guessed the song? (+3 pts)</p>
                    <div className="player-picker" style={{ marginBottom: "14px" }}>
                      {players.map((p) => (
                        <button key={p.name} className="player-pick-btn" onClick={() => awardPoint(p.name)}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p style={{ textAlign: "center", color: "#1DB954", fontSize: "13px", marginBottom: "14px" }}>
                    +3 pts → {roundWinner}
                  </p>
                )}

                {/* Album scoring — 1 pt, only if track has album. Compact: the
                    song is the question every round, the album is the bonus,
                    and three equal-sized banks of the same names made the host
                    hunt for which row was which. No "No one" button — Next
                    Track is what nobody-got-it looks like. */}
                {currentTrack?.albumName && (
                  <div className="score-row-compact">
                    <span className="score-row-label">Album +1</span>
                    {!albumPointsAwarded ? (
                      players.map((p) => (
                        <button
                          key={p.name}
                          className="player-pick-btn compact"
                          onClick={() => awardAlbumPoint(p.name)}
                        >
                          {p.name}
                        </button>
                      ))
                    ) : (
                      <span className="score-row-done">
                        +1 pt → {albumWinner}
                      </span>
                    )}
                  </div>
                )}

                {/* Source scoring — 2 pts, Mixed Playlist Mode only. Every player is */}
                {/* eligible, including this track's contributor(s) — sampling means a */}
                {/* contributor doesn't know which of their tracks made the pool, so they */}
                {/* may not recognize their own track any faster than anyone else. */}
                {currentTrack?.contributors && currentTrack.contributors.length > 0 && (
                  <div className="score-row-compact">
                    <span className="score-row-label">Whose playlist +2</span>
                    {!sourcePointsAwarded ? (
                      players.map((p) => (
                        <button
                          key={p.name}
                          className="player-pick-btn compact"
                          onClick={() => awardSourcePoint(p.name)}
                        >
                          {p.name}
                        </button>
                      ))
                    ) : (
                      <span className="score-row-done">
                        +2 pts → {sourceWinner}
                      </span>
                    )}
                  </div>
                )}

                <button className="btn-primary" onClick={nextTrack} style={{ flex: "none", display: "block", margin: "0 auto", minWidth: "180px", width: "fit-content" }}>
                  {currentIndex + 1 >= tracks.length ? "See Final Scores →" : "Next Track →"}
                </button>
              </div>
            )}
          </div>

          {/* Finished overlay (full screen inside main) */}
          {phase === "finished" && (
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

              {/* How the scoring actually went, which the scoreboard cannot
                  show: two rooms reach the same final scores with completely
                  different rounds behind them. Mixed only, because
                  `setRoundHistory` only records mixed rounds — a non-mixed game
                  would render a line built from an empty array. */}
              {playlistSource === "mixed" && roundSummaryLine && (
                <p className="round-summary">{roundSummaryLine}</p>
              )}

              {installCta && <InstallCta onInstall={handleInstall} />}

              {/* One primary — the thing everyone on this screen does next —
                  and the save/share actions as a quieter row under it, so
                  four same-sized buttons stop competing for the tap. */}
              <button className="btn-lg green" onClick={playAgain}>
                Play Again →
              </button>
              <div className="finished-secondary">
                <button className="btn-ghost compact" onClick={downloadResultImage}>
                  Save Results
                </button>
                {playlistSource === "mixed" && (
                  <button className="btn-ghost compact" onClick={downloadTasteCard}>
                    Save Taste Card
                  </button>
                )}
                {playlistSource === "mixed" && (
                  <button className="btn-ghost compact" onClick={copyMixList}>
                    {mixCopied ? "Copied ✓" : "Copy the Mix"}
                  </button>
                )}
              </div>

              {/* Clipboard refused. Showing the text is not a consolation
                  prize — it is the same payload by a route the browser cannot
                  veto. */}
              {mixFallback && (
                <textarea
                  className="mix-fallback"
                  readOnly
                  value={mixFallback}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="The mixed playlist, ready to copy"
                />
              )}

              {/* The room is looking at this screen with their phones already
                  in hand, which is the one moment in the game when a way onward
                  costs the host nothing to offer. On a phone the screen *is*
                  the phone in hand, so the way onward is a link — and the QR
                  is not rendered at all, because rendering is what reports
                  its impression. lib/game-over.ts. */}
              {onward === "qr" && <LoopQr />}
              {onward === "mixed_link" && (
                <a className="next-game-link" href={MIXED_SETUP_HREF} onClick={openMixedSetup}>
                  {MIXED_NEXT_GAME_LABEL}
                </a>
              )}
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
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
