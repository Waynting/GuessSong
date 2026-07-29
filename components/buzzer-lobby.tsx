"use client";

/**
 * Pre-game lobby for Buzzer Mode.
 *
 * The room used to be created on "Start Game", which meant the QR code only
 * appeared once the first clip was already queued — everyone stood around
 * scanning while the music played. Opening the room here, before the game
 * starts, gives people the same "scan, join, wait" beat that Mixed Playlist
 * Mode's room already has.
 *
 * The host holds a live socket from this screen, so the joined list is the
 * room's actual state rather than a guess. That socket closes when this
 * unmounts and the game page opens its own with the same playerId, which the
 * room treats as the same host reconnecting.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { createBuzzerRoom, buzzerJoinUrl, BuzzerUnavailableError } from "@/lib/buzzer-client";
import { useBuzzerSocket } from "@/lib/use-buzzer-socket";
import { trackEvent } from "@/lib/analytics";
import type { BuzzerRoomHandle } from "@/lib/game-session";

export interface BuzzerLobbyProps {
  room: BuzzerRoomHandle | null;
  onRoomCreated: (room: BuzzerRoomHandle) => void;
  /** Live count of joined phones, so the parent can gate "Start Game". */
  onPlayerCountChange?: (count: number) => void;
}

export function BuzzerLobby({ room, onRoomCreated, onPlayerCountChange }: BuzzerLobbyProps) {
  // The host buzzes like everyone else, so they need a name the scoreboard can
  // award points to. Persisted per browser so a host isn't retyping it every
  // party.
  const [hostName, setHostName] = useState("Host");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("guesssong_host_name");
    if (saved) setHostName(saved);
  }, []);

  const { snapshot, connected } = useBuzzerSocket({
    code: room?.code ?? null,
    name: room?.hostName ?? hostName,
    hostToken: room?.hostToken,
  });

  // Phones that scanned in. The host is in the room's player list too, but they
  // are the big screen rather than a phone, so they don't belong in this count.
  const players = (snapshot?.players ?? []).filter(
    (p) => p.name !== (room?.hostName ?? hostName)
  );

  useEffect(() => {
    onPlayerCountChange?.(players.length);
  }, [players.length, onPlayerCountChange]);

  useEffect(() => {
    if (!room) return;
    QRCode.toDataURL(buzzerJoinUrl(room.code), { margin: 1, width: 240 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [room]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const trimmed = hostName.trim() || "Host";
      window.localStorage.setItem("guesssong_host_name", trimmed);
      const created = await createBuzzerRoom();
      trackEvent("buzz_room_created", {});
      onRoomCreated({ ...created, hostName: trimmed });
    } catch (e: unknown) {
      setError(
        e instanceof BuzzerUnavailableError ? e.message : "Couldn't open a buzzer room"
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleShare() {
    if (!room) return;
    const url = buzzerJoinUrl(room.code);
    try {
      if (navigator.share) {
        await navigator.share({ url, title: `Join buzzer room ${room.code} on GuessSong` });
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
          Open the room first so everyone can scan in before the music starts.
          Each player gets a buzzer on their own phone.
        </p>
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
        <button className="start-btn" onClick={handleCreate} disabled={creating}>
          {creating ? "Opening Room..." : "Open Buzzer Room"}
        </button>
        {error && (
          <p style={{ marginTop: "10px", fontSize: "12px", color: "#fca5a5" }}>{error}</p>
        )}
      </div>
    );
  }

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
          alt={`QR code to join buzzer room ${room.code}`}
          style={{ width: "180px", height: "180px", margin: "0 auto 12px", borderRadius: "8px" }}
        />
      )}
      <button className="add-player-btn" onClick={handleShare} style={{ marginBottom: "14px" }}>
        {copied ? "✓ Link copied" : "Share Join Link"}
      </button>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "14px" }}>
        Can&apos;t scan? Send that link instead — it&apos;s the same thing.
      </p>

      <p style={{ fontSize: "12px", color: "#666", marginBottom: players.length ? "10px" : "0" }}>
        {connected
          ? `${players.length} phone${players.length === 1 ? "" : "s"} ready`
          : "Connecting to room…"}
      </p>

      {players.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
          {players.map((p) => (
            <span
              key={p.playerId}
              style={{
                fontSize: "13px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: p.connected ? "#14331f" : "#222",
                color: p.connected ? "#8fd6a5" : "#777",
              }}
            >
              {p.name}
              {!p.connected && " (away)"}
            </span>
          ))}
        </div>
      )}

      {players.length === 0 && connected && (
        <p style={{ fontSize: "12px", color: "#555", marginTop: "10px" }}>
          Nobody has scanned yet. You can still start — latecomers can join mid-game.
        </p>
      )}
    </div>
  );
}
