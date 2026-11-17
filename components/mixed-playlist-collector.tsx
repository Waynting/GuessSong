"use client";

import { useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { SETUP_COPY, type SetupLocale } from "@/lib/setup-copy";
import { usePlaylistLinkCheck } from "@/lib/use-playlist-link";
import { ROOM_MAX_SUBMISSIONS } from "@/types/room";

export interface MixedContribution {
  name: string;
  playlistUrl: string;
}

interface MixedPlaylistCollectorProps {
  contributions: MixedContribution[];
  onAdd: (contribution: MixedContribution) => void;
  onRemove: (index: number) => void;
  /** The setup page's language (lib/setup-copy.ts); English when omitted. */
  locale?: SetupLocale;
}

/**
 * v0 pass-the-phone collector: each player takes the host's device, enters
 * their name + playlist URL, and hands it to the next person. The
 * "just added" screen masks the form between turns — reuses the setup
 * pages' shared .card/.pill/.player-input/.url-input/.start-btn styles
 * (`<SetupStyles />` in components/setup-chrome.tsx) rather than declaring
 * its own, since it only ever renders inside that shell.
 */
export function MixedPlaylistCollector({
  contributions,
  onAdd,
  onRemove,
  locale: pageLocale = "en",
}: MixedPlaylistCollectorProps) {
  const copy = SETUP_COPY[pageLocale].collector;
  const [name, setName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // The server's own reading (lib/spotify-link.ts). What passes here is
  // loaded by `/api/playlist` at Start, one request per contributor, so a
  // link this let through and the server refused would fail the whole mix
  // after everyone had already handed the phone on.
  const playlistLink = usePlaylistLinkCheck(playlistUrl, "collector");
  // The device's language for errors, except on the Portuguese page.
  const deviceLocale = useErrorLocale();
  const locale = pageLocale === "pt" ? "pt" : deviceLocale;
  const trimmedName = name.trim();
  const isDuplicateName = contributions.some(
    (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
  );
  const isFull = contributions.length >= ROOM_MAX_SUBMISSIONS;
  const canAdd =
    trimmedName.length > 0 && playlistLink.submittable && !isDuplicateName && !isFull;

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
        <p style={{ fontSize: "16px", color: "#1DB954", fontWeight: 600 }}>
          {copy.full(ROOM_MAX_SUBMISSIONS)}
        </p>
      </div>
    );
  } else if (justAdded) {
    form = (
      <div className="card" style={{ padding: "28px", textAlign: "center" }}>
        <p style={{ fontSize: "16px", color: "#1DB954", fontWeight: 600, marginBottom: "6px" }}>
          {copy.added(justAdded)}
        </p>
        <p style={{ fontSize: "13px", color: "#777", marginBottom: "20px" }}>
          {copy.passOn}
        </p>
        <button className="start-btn" onClick={() => setJustAdded(null)}>
          {copy.next}
        </button>
      </div>
    );
  } else {
    form = (
      <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <p className="section-label">{copy.yourName}</p>
          <input
            type="text"
            className="player-input"
            placeholder={copy.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            style={{ width: "100%" }}
          />
          {isDuplicateName && (
            <p style={{ fontSize: "12px", color: "#e85555", marginTop: "6px" }}>
              {copy.nameTaken}
            </p>
          )}
        </div>
        <div>
          <p className="section-label">{copy.yourPlaylist}</p>
          <div style={{ position: "relative" }}>
            <input
              type="url"
              className={`url-input${playlistLink.submittable ? " valid" : ""}`}
              placeholder={SETUP_COPY[pageLocale].playlistPlaceholder}
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
          {playlistLink.problem && (
            <p style={{ fontSize: "12px", color: "#e85555", marginTop: "6px", lineHeight: 1.5 }}>
              {errorMessage(playlistLink.problem, locale)}
            </p>
          )}
        </div>
        <button className="start-btn" onClick={handleAdd} disabled={!canAdd}>
          {copy.addAndPass}
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
            {copy.joined(contributions.length)}
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
                  aria-label={copy.remove(c.name)}
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
