/**
 * The merged playlist, handed back as text.
 *
 * ## Why anything is handed back
 *
 * `poolContributions` (`lib/mixed-playlist.ts`) already builds the one artifact
 * a group event actually wants — everyone's music, deduped, with each song
 * still attached to whoever brought it — and then the game throws it away at
 * the final screen. The party ends with a scoreboard and a picture, and the
 * playlist that took a dozen people ten minutes to assemble exists nowhere.
 *
 * Text rather than a Spotify playlist, and that is not a shortcut: creating a
 * playlist needs user OAuth, and having no accounts is the premise the entire
 * product is built on. Text pastes into a group chat, which is where the people
 * who made it already are.
 *
 * ## The roster comes from the roster, not from the tracks
 *
 * `contributorNames` is passed in separately and every name in it is printed,
 * including names that no sampled track belongs to. Deriving the roster from
 * the tracks would be shorter and would silently erase anybody whose playlist
 * lost the sampling — they queued up, scanned a code, handed over their music,
 * and would not appear anywhere in the record of the evening. Sampling makes
 * that outcome ordinary rather than rare: `poolContributions` fills to a target
 * and stops, so with enough contributors somebody gets zero.
 */

import type { Track } from "@/types";

/** Roughly the width of a phone message before it starts wrapping badly. */
const MAX_TITLE = 60;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function creditFor(track: Track): string {
  const names = track.contributors ?? [];
  if (names.length === 0) return "";
  if (names.length === 1) return ` (${names[0]})`;
  return ` (${names.slice(0, -1).join(", ")} & ${names[names.length - 1]})`;
}

export interface MixExportInput {
  tracks: readonly Track[];
  /** Everyone who submitted, whether or not their songs made the pool. */
  contributorNames: readonly string[];
  playlistName: string;
}

/**
 * Returns the whole thing as one string ready for the clipboard.
 *
 * Never throws and never returns null: a mix with no tracks still names the
 * people who turned up, which is the part that would hurt to lose.
 */
export function formatMixList({
  tracks,
  contributorNames,
  playlistName,
}: MixExportInput): string {
  const lines: string[] = [];

  lines.push(`${playlistName} · guessong.app`);

  const roster = contributorNames.filter((n) => n.trim().length > 0);
  const songWord = tracks.length === 1 ? "song" : "songs";
  lines.push(
    roster.length > 0
      ? `${tracks.length} ${songWord} from ${roster.join(", ")}`
      : `${tracks.length} ${songWord}`
  );

  if (tracks.length > 0) {
    lines.push("");
    // Padded so the numbers line up in a monospaced chat client and stay
    // readable in a proportional one. 144 is the pool ceiling (12 contributors
    // times the largest per-player sample), so two columns is always enough.
    const width = String(tracks.length).length;
    tracks.forEach((track, i) => {
      const n = String(i + 1).padStart(width, " ");
      const title = truncate(track.name, MAX_TITLE);
      const artist = track.artists[0] ?? "";
      lines.push(`${n}. ${title}${artist ? ` — ${artist}` : ""}${creditFor(track)}`);
    });
  }

  const credited = new Set<string>();
  for (const track of tracks) {
    for (const name of track.contributors ?? []) credited.add(name);
  }
  const empty = roster.filter((name) => !credited.has(name));
  if (empty.length > 0) {
    lines.push("");
    lines.push(
      empty.length === 1
        ? `${empty[0]} submitted a playlist but none of it made this round.`
        : `${empty.slice(0, -1).join(", ")} and ${empty[empty.length - 1]} submitted playlists but none of them made this round.`
    );
  }

  return lines.join("\n");
}
