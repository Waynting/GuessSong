"use client";

/**
 * The one room step on the setup page.
 *
 * There used to be two of these — a Mixed Playlist room card and a Buzzer
 * lobby — and a game with both modes on showed both, so players scanned twice
 * for two unrelated codes. This panel opens whichever backends the chosen modes
 * actually need (see lib/room-client.ts) and shows a single code and QR for
 * them. It sits *after* the settings on purpose: everything is configured
 * first, and the code appears last, when it is genuinely time to gather people.
 *
 * It reads its roster from whichever room can answer:
 *
 * - **Buzzer on** — a live socket, so joined phones appear the moment they land.
 *   The host holds this socket from here and the game page opens its own with
 *   the same playerId, which the room treats as the same host reconnecting.
 * - **Playlists on** — polling `/api/room/:code/status`, the mailbox's only
 *   readback. It is also what says who has actually submitted a playlist, which
 *   the socket cannot know.
 *
 * With both on, the phone list is the roster and the poll decorates it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { BuzzerUnavailableError } from "@/lib/buzzer-client";
import { buildRoster, openRoom, roomJoinUrl, type OpenRoom } from "@/lib/room-client";
import { useBuzzerSocket } from "@/lib/use-buzzer-socket";
import { roomJobs, trackEvent } from "@/lib/analytics";
import { DEFAULT_HOST_NAME } from "@/lib/game-session";
import { apiError, describeError, errorMessage } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import {
  ROOM_POLL_INTERVAL_MS,
  canPollAgainAfter,
  pollTickAction,
} from "@/lib/room-poll";
import { ROOM_TTL_SECONDS, type RoomSubmissionSummary } from "@/types/room";

const HOST_NAME_STORAGE_KEY = "guesssong_host_name";

export interface RoomPanelProps {
  /** Collect playlist URLs from players (Mixed Playlist Mode's QR flow). */
  collectsPlaylists: boolean;
  /** Give every player a buzzer on their phone. */
  buzzer: boolean;
  room: OpenRoom | null;
  onOpened: (room: OpenRoom) => void;
  /** Live count of joined phones, so the parent can label "Start Game". */
  onPhoneCountChange?: (count: number) => void;
  /** Who has submitted a playlist — the parent gates starting on this. */
  onSubmissionsChange?: (submissions: RoomSubmissionSummary[]) => void;
}

export function RoomPanel({
  collectsPlaylists,
  buzzer,
  room,
  onOpened,
  onPhoneCountChange,
  onSubmissionsChange,
}: RoomPanelProps) {
  // The host buzzes like everyone else, so they need a name the scoreboard can
  // award points to. Persisted per browser so a host isn't retyping it every
  // party.
  const [hostName, setHostName] = useState(DEFAULT_HOST_NAME);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submissions, setSubmissions] = useState<RoomSubmissionSummary[]>([]);
  const submissionTotalRef = useRef(0);
  // The host's own contribution. They are holding the screen everyone else is
  // scanning, so they are the one player with no phone to scan it from.
  const [hostPlaylistUrl, setHostPlaylistUrl] = useState("");
  const [hostSubmitting, setHostSubmitting] = useState(false);
  const [hostTrackCount, setHostTrackCount] = useState<number | null>(null);
  const [hostSubmitError, setHostSubmitError] = useState<string | null>(null);
  const locale = useErrorLocale();

  useEffect(() => {
    const saved = window.localStorage.getItem(HOST_NAME_STORAGE_KEY);
    if (saved) setHostName(saved);
  }, []);

  // Null code means "don't connect", which is exactly right for a room that
  // has no buzzer half — the hook is still called unconditionally.
  const { snapshot, connected } = useBuzzerSocket({
    code: room?.buzzer ? room.code : null,
    name: room?.buzzer?.hostName ?? hostName,
    hostToken: room?.buzzer?.hostToken,
  });

  // Phones that scanned in. The host is in the room's player list too, but they
  // are the big screen rather than a phone, so they don't belong in this count.
  const hostLabel = room?.buzzer?.hostName ?? hostName;
  const phones = useMemo(
    () => (snapshot?.players ?? []).filter((p) => p.name !== hostLabel),
    [snapshot?.players, hostLabel]
  );

  useEffect(() => {
    onPhoneCountChange?.(phones.length);
  }, [phones.length, onPhoneCountChange]);

  useEffect(() => {
    onSubmissionsChange?.(submissions);
  }, [submissions, onSubmissionsChange]);

  /**
   * One poll. Returns false when the mailbox can never answer differently,
   * which is the loop's signal to stop asking rather than to retry.
   */
  const pollStatus = useCallback(async (code: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/room/${code}/status`);
      // Which statuses are terminal is policy, and lives in lib/room-poll.ts
      // where the test suite can reach it.
      if (!canPollAgainAfter(res.status)) return false;
      if (!res.ok) return true;
      const data = await res.json();
      setSubmissions(data.submissions);
      if (data.total > submissionTotalRef.current) {
        submissionTotalRef.current = data.total;
        trackEvent("room_submission_received", { total: data.total });
      }
      return true;
    } catch {
      // Transient network hiccup while polling — the next tick retries.
      return true;
    }
  }, []);

  /**
   * The roster poll, which has to be able to stop.
   *
   * This was a bare `setInterval` that ran for as long as the panel was
   * mounted, and it is the single most expensive thing the app does to Upstash:
   * two commands a tick (the route's rate-limit `incr`, then the room read),
   * every four seconds, per open tab. A host who opens a room and walks away —
   * or just leaves the setup tab parked behind another — spends ~43k commands a
   * day against a quota of 500k a *month*, and none of it buys anything, since
   * `ROOM_TTL_SECONDS` deletes the room half an hour in and every poll after
   * that is a 404 the old code quietly swallowed and retried forever. A dozen
   * abandoned tabs is the whole monthly budget, spent invisibly on rooms that
   * no longer exist. Three bounds, because the leak had three ways to run:
   *
   *   terminal status  the room is gone or already started — stop for good
   *   deadline         nothing outlives ROOM_TTL_SECONDS, so neither does this
   *   visibility       a background tab still fires timers; it just skips the
   *                    fetch, and polls once on return so the roster is current
   *
   * All three decisions are `lib/room-poll.ts`, which the test suite can reach;
   * what is left here is only the scheduling around them.
   */
  useEffect(() => {
    if (!room?.collectsPlaylists) return;
    const code = room.code;
    const deadline = Date.now() + ROOM_TTL_SECONDS * 1000;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    // setTimeout rather than setInterval: a poll that outlasts the interval
    // would otherwise stack up ticks behind it, which is how a slow network
    // turns one poller into several.
    const tick = async () => {
      if (stopped) return;
      const action = pollTickAction({
        now: Date.now(),
        deadline,
        visible: document.visibilityState === "visible",
      });
      if (action === "stop") {
        stop();
        return;
      }
      if (action === "fetch" && !(await pollStatus(code))) {
        stop();
        return;
      }
      if (stopped) return;
      timer = setTimeout(tick, ROOM_POLL_INTERVAL_MS);
    };

    void tick();

    const onVisibilityChange = () => {
      if (stopped) return;
      // Through the same policy as a tick, not just a visibility check: a tab
      // restored hours later must not spend a request rediscovering a room the
      // deadline already knows has expired.
      const action = pollTickAction({
        now: Date.now(),
        deadline,
        visible: document.visibilityState === "visible",
      });
      if (action === "stop") {
        stop();
        return;
      }
      if (action !== "fetch") return;
      void pollStatus(code).then((keepGoing) => {
        if (!keepGoing) stop();
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [room?.collectsPlaylists, room?.code, pollStatus]);

  useEffect(() => {
    if (!room) return;
    QRCode.toDataURL(roomJoinUrl(room), { margin: 1, width: 240 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [room]);

  async function handleOpen() {
    setOpening(true);
    setError(null);
    try {
      const trimmed = hostName.trim() || DEFAULT_HOST_NAME;
      if (buzzer) window.localStorage.setItem(HOST_NAME_STORAGE_KEY, trimmed);
      submissionTotalRef.current = 0;
      setSubmissions([]);
      // A fresh room has a fresh mailbox — the host has submitted nothing to it
      // yet, whatever they did in a room they abandoned by switching modes.
      setHostTrackCount(null);
      setHostSubmitError(null);
      const opened = await openRoom({ collectsPlaylists, buzzer, hostName: trimmed });
      const jobs = roomJobs(opened.collectsPlaylists, Boolean(opened.buzzer));
      if (opened.collectsPlaylists) trackEvent("room_created", { room_jobs: jobs });
      if (opened.buzzer) trackEvent("buzz_room_created", { room_jobs: jobs });
      onOpened(opened);
    } catch (e: unknown) {
      // A room that never opens is the one failure the funnel can't infer: the
      // host sees an error and gives up, and every downstream event simply never
      // happens. Buzzer-unavailable is split out because it means the Worker is
      // down for everyone, not that this host did something wrong.
      trackEvent("room_open_failed", {
        room_jobs: roomJobs(collectsPlaylists, buzzer),
        reason: e instanceof BuzzerUnavailableError ? "buzzer_unavailable" : "other",
      });
      setError(
        e instanceof BuzzerUnavailableError
          ? errorMessage(e.code, locale)
          : describeError(e, locale, "room_open_failed")
      );
    } finally {
      setOpening(false);
    }
  }

  /**
   * Submit the host's own playlist into the room's mailbox.
   *
   * Everyone else contributes by scanning the QR on this screen, which the host
   * cannot do — they *are* the screen. Without this they either sat out of
   * their own party's pool, or had to open the join link on a second device.
   * It posts to the same `/api/room/[code]/submit` a scanned phone does, so the
   * host lands in the roster, the pool, and the ≥2-contributor gate on exactly
   * the same terms as a guest.
   */
  async function handleHostSubmit() {
    const trimmed = hostLabel.trim() || DEFAULT_HOST_NAME;
    if (!room || !hostPlaylistUrl.trim()) return;
    setHostSubmitting(true);
    setHostSubmitError(null);
    // Same 410 bucketing as the player pages, for consistency rather than because
    // it is reachable — a host whose room is consumed has already left for /game.
    let tooLate = false;
    try {
      const res = await fetch(`/api/room/${room.code}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: trimmed, playlistUrl: hostPlaylistUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        tooLate = res.status === 410;
        throw apiError(data, "room_host_submit_failed");
      }
      window.localStorage.setItem(HOST_NAME_STORAGE_KEY, trimmed);
      setHostTrackCount(data.trackCount);
      trackEvent("room_submission_sent", {
        submitted_by: "host",
        track_count: data.trackCount,
      });
      // Don't wait for the next poll tick to prove it worked.
      void pollStatus(room.code);
    } catch (e: unknown) {
      trackEvent("room_submission_failed", {
        submitted_by: "host",
        reason: tooLate ? "too_late" : "other",
      });
      setHostSubmitError(describeError(e, locale, "room_host_submit_failed"));
    } finally {
      setHostSubmitting(false);
    }
  }

  async function handleShare() {
    if (!room) return;
    const url = roomJoinUrl(room);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ url, title: `Join room ${room.code} on GuessSong` });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed or clipboard blocked. The code and QR on screen
      // are still perfectly usable, so there is nothing to recover from.
    }
  }

  if (!room) {
    return (
      <div className="card" style={{ padding: "24px", textAlign: "center" }}>
        <p style={{ fontSize: "13px", color: "#777", marginBottom: "16px" }}>
          {describeRoom(collectsPlaylists, buzzer)}
        </p>
        {buzzer && (
          <>
            <label
              style={{ display: "block", fontSize: "12px", color: "#777", marginBottom: "6px" }}
              htmlFor="host-name"
            >
              Your name — you can buzz from this screen too
            </label>
            <input
              id="host-name"
              className="player-input"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              maxLength={24}
              style={{ marginBottom: "16px", textAlign: "center" }}
            />
          </>
        )}
        <button className="start-btn" onClick={handleOpen} disabled={opening}>
          {opening ? "Opening Room..." : "Open Room"}
        </button>
        {error && <p style={{ marginTop: "10px", fontSize: "12px", color: "#fca5a5" }}>{error}</p>}
      </div>
    );
  }

  const roster = buildRoster(
    phones.map((p) => ({ name: p.name, connected: p.connected })),
    submissions,
    room.collectsPlaylists,
    Boolean(room.buzzer)
  );

  return (
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
        {room.code}
      </p>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element -- client-generated data: URI
        <img
          src={qr}
          alt={`QR code to join room ${room.code}`}
          style={{ width: "180px", height: "180px", margin: "0 auto 12px", borderRadius: "8px" }}
        />
      )}
      <button className="add-player-btn" onClick={handleShare} style={{ marginBottom: "14px" }}>
        {copied ? "✓ Link copied" : "Share Join Link"}
      </button>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "14px" }}>
        Can&apos;t scan? Send that link instead — it&apos;s the same thing.
      </p>

      <p style={{ fontSize: "12px", color: "#666", marginBottom: roster.length ? "10px" : "0" }}>
        {/* "in the room", not "joined": once the host adds their own playlist
            they show up in this list too, and they didn't scan anything. */}
        {room.buzzer && !connected
          ? "Connecting to room…"
          : `${roster.length} in the room`}
      </p>

      {roster.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
          {roster.map((r) => (
            <span
              key={r.name}
              style={{
                fontSize: "13px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: r.live === false ? "#222" : "#14331f",
                color: r.live === false ? "#777" : "#8fd6a5",
              }}
            >
              {r.name}
              {room.collectsPlaylists && (
                <span style={{ color: "#666" }}>
                  {r.trackCount === undefined
                    ? " · no playlist yet"
                    : ` · ${r.trackCount} tracks`}
                </span>
              )}
              {r.live === false && " (away)"}
            </span>
          ))}
        </div>
      )}

      {roster.length === 0 && (!room.buzzer || connected) && (
        <p style={{ fontSize: "12px", color: "#555", marginTop: "10px" }}>
          {room.buzzer
            ? "Nobody has scanned yet. You can still start — latecomers can join mid-game."
            : "Nobody has scanned yet."}
        </p>
      )}

      {/* The host's own playlist. Everyone else contributes by scanning the QR
          above; the host is the one person who can't, because they're holding
          the screen it's on. */}
      {room.collectsPlaylists && (
        <div
          style={{
            marginTop: "16px",
            paddingTop: "16px",
            borderTop: "1px solid #2a2a2a",
            textAlign: "left",
          }}
        >
          {hostTrackCount !== null ? (
            <p style={{ fontSize: "13px", color: "#8fd6a5" }}>
              ✓ Your playlist is in — {hostTrackCount} track
              {hostTrackCount === 1 ? "" : "s"} from {hostLabel}
            </p>
          ) : (
            <>
              <p style={{ fontSize: "12px", color: "#777", marginBottom: "8px" }}>
                Add your own playlist — you can&apos;t scan your own QR code.
              </p>
              {!buzzer && (
                <input
                  className="player-input"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Your name"
                  maxLength={24}
                  style={{ width: "100%", marginBottom: "8px" }}
                />
              )}
              <input
                type="url"
                className="player-input"
                value={hostPlaylistUrl}
                onChange={(e) => setHostPlaylistUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                spellCheck={false}
                style={{ width: "100%", marginBottom: "8px" }}
              />
              <button
                className="add-player-btn"
                onClick={handleHostSubmit}
                // Same shape check the join page makes, so an obvious typo
                // fails here instead of after a round trip to Spotify.
                disabled={
                  hostSubmitting ||
                  !(
                    hostPlaylistUrl.includes("spotify.com/playlist") ||
                    hostPlaylistUrl.includes("spotify:playlist:")
                  )
                }
              >
                {hostSubmitting ? "Adding..." : "Add My Playlist"}
              </button>
              {hostSubmitError && (
                <p style={{ marginTop: "8px", fontSize: "12px", color: "#fca5a5" }}>
                  {hostSubmitError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* The mailbox closes at kickoff while the buzzer room runs all game, so
          say so rather than letting a host wonder why one QR covers both. */}
      {room.buzzer && room.collectsPlaylists && (
        <p style={{ fontSize: "12px", color: "#555", marginTop: "12px", lineHeight: 1.5 }}>
          One code for both: players add a playlist and get a buzzer in the same
          step. Playlists close when the game starts; the buzzers stay open.
        </p>
      )}
    </div>
  );
}

function describeRoom(collectsPlaylists: boolean, buzzer: boolean): string {
  if (collectsPlaylists && buzzer) {
    return "One QR code does both — players scan it, add their own playlist, and get a buzzer on their phone.";
  }
  if (collectsPlaylists) {
    return "Generate a QR code — players scan it to add their own playlist from their own phone.";
  }
  return "Open the room so everyone can scan in before the music starts. Each player gets a buzzer on their own phone.";
}
