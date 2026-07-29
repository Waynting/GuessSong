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
import { trackEvent } from "@/lib/analytics";
import { DEFAULT_HOST_NAME } from "@/lib/game-session";
import type { RoomSubmissionSummary } from "@/types/room";

const HOST_NAME_STORAGE_KEY = "guesssong_host_name";
const ROOM_POLL_INTERVAL_MS = 4000;

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

  const pollStatus = useCallback(async (code: string) => {
    try {
      const res = await fetch(`/api/room/${code}/status`);
      const data = await res.json();
      if (!res.ok) return;
      setSubmissions(data.submissions);
      if (data.total > submissionTotalRef.current) {
        submissionTotalRef.current = data.total;
        trackEvent("room_submission_received", { total: data.total });
      }
    } catch {
      // Transient network hiccup while polling — the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (!room?.collectsPlaylists) return;
    const code = room.code;
    pollStatus(code);
    const id = setInterval(() => pollStatus(code), ROOM_POLL_INTERVAL_MS);
    return () => clearInterval(id);
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
      const opened = await openRoom({ collectsPlaylists, buzzer, hostName: trimmed });
      if (opened.collectsPlaylists) trackEvent("room_created", {});
      if (opened.buzzer) trackEvent("buzz_room_created", {});
      onOpened(opened);
    } catch (e: unknown) {
      setError(
        e instanceof BuzzerUnavailableError || e instanceof Error
          ? e.message
          : "Couldn't open the room"
      );
    } finally {
      setOpening(false);
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
        {room.buzzer && !connected
          ? "Connecting to room…"
          : `${roster.length} player${roster.length === 1 ? "" : "s"} joined`}
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
