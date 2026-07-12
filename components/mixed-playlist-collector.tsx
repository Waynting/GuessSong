"use client";

import { useState, type ReactNode } from "react";
import { ROOM_MAX_SUBMISSIONS } from "@/types/room";

export interface MixedContribution {
  name: string;
  playlistUrl: string;
}

interface MixedPlaylistCollectorProps {
  contributions: MixedContribution[];
  onAdd: (contribution: MixedContribution) => void;
  onRemove: (index: number) => void;
}

/**
 * v0 pass-the-phone collector: each player takes the host's device, enters
 * their name + playlist URL, and hands it to the next person. The
 * "just added" screen masks the form between turns — reuses app/page.tsx's
 * global .card/.pill/.player-input/.url-input/.start-btn styles rather than
 * declaring its own, since it only ever renders inside that page.
 */
export function MixedPlaylistCollector({
  contributions,
  onAdd,
  onRemove,
}: MixedPlaylistCollectorProps) {
  const [name, setName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const isValidUrl =
    playlistUrl.includes("spotify.com/playlist") || playlistUrl.includes("spotify:playlist:");
  const trimmedName = name.trim();
  const isDuplicateName = contributions.some(
    (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
  );
  const isFull = contributions.length >= ROOM_MAX_SUBMISSIONS;
  const canAdd = trimmedName.length > 0 && isValidUrl && !isDuplicateName && !isFull;

  function handleAdd() {
    if (!canAdd) return;
    onAdd({ name: trimmedName, playlistUrl: playlistUrl.trim() });
    setJustAdded(trimmedName);
    setName("");
    setPlaylistUrl("");
  }

  let form: ReactNode;
  if (isFull) {
    form = (
      <div className="card" style={{ padding: "28px", textAlign: "center" }}>
        <p style={{ fontSize: "16px", color: "#1DB954", fontWeight: 600, marginBottom: "6px" }}>
          {ROOM_MAX_SUBMISSIONS} players joined — that&apos;s the max
        </p>
        <p style={{ fontSize: "13px", color: "#777" }}>Remove someone below to add another.</p>
      </div>
    );
  } else if (justAdded) {
    form = (
      <div className="card" style={{ padding: "28px", textAlign: "center" }}>
        <p style={{ fontSize: "16px", color: "#1DB954", fontWeight: 600, marginBottom: "6px" }}>
          ✓ {justAdded}&apos;s playlist is in
        </p>
        <p style={{ fontSize: "13px", color: "#777", marginBottom: "20px" }}>
          Pass the phone to the next player
        </p>
        <button className="start-btn" onClick={() => setJustAdded(null)}>
          Next Player →
        </button>
      </div>
    );
  } else {
    form = (
      <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <p className="section-label">Your Name</p>
          <input
            type="text"
            className="player-input"
            placeholder="Player name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            style={{ width: "100%" }}
          />
          {isDuplicateName && (
            <p style={{ fontSize: "12px", color: "#e85555", marginTop: "6px" }}>
              That name already joined — pick a different one.
            </p>
          )}
        </div>
        <div>
          <p className="section-label">Your Spotify Playlist</p>
          <div style={{ position: "relative" }}>
            <input
              type="url"
              className={`url-input${isValidUrl ? " valid" : ""}`}
              placeholder="https://open.spotify.com/playlist/..."
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
        <button className="start-btn" onClick={handleAdd} disabled={!canAdd}>
          Add &amp; Pass Phone →
        </button>
      </div>
    );
  }

  return (
    <div>
      {form}

      {contributions.length > 0 && (
        <div style={{ marginTop: "14px" }}>
          <p className="section-label">
            {contributions.length} player{contributions.length === 1 ? "" : "s"} joined
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {contributions.map((c, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#1a1a1a",
                  border: "1px solid #2a2a2a",
                  borderRadius: "8px",
                  padding: "10px 14px",
                }}
              >
                <span style={{ flex: 1, fontSize: "14px" }}>{c.name}</span>
                <button
                  className="remove-btn"
                  onClick={() => onRemove(idx)}
                  aria-label={`Remove ${c.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
