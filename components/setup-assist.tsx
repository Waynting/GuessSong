"use client";

/**
 * The four things the setup form says to a host beyond its own fields: that
 * it filled itself in, which playlists they played lately, what to do about a
 * link that was refused, and that the link they have just pasted is one of
 * Spotify's own.
 *
 * They live here rather than in `app/page.tsx` for the reason
 * `components/setup-chrome.tsx` gives for itself — a class name a component
 * depends on should be declared in a file it imports — and they are kept to
 * markup: which chips, which help and which warning is decided in `lib/`
 * (`setup-memory`, `playlist-help`, `starter-playlists`), where the suite can
 * reach it.
 *
 * This sheet is on `tests/mobile.test.ts`'s list with the setup chrome, so
 * the phone rules hold here too: a hover style only where there is a pointer
 * that hovers, a pressed state on everything that can be pressed, and the
 * press landing at once.
 */

import type { PlaylistHelp } from "@/lib/playlist-help";

export function SetupAssistStyles() {
  return (
    <style>{`
      /* The line above the card. It sits in the gap the header already
         leaves, pulled up into it, so telling a returning host why the form
         is full moves the card down 12px and not a row. */
      .recall-note {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: center;
        gap: 2px 10px;
        margin: -20px 0 12px;
        font-size: 13px;
        color: #888;
        text-align: center;
      }

      .chip-block { margin-top: 10px; }
      .chip-caption {
        font-size: 12px;
        color: #999;
        margin-bottom: 6px;
      }
      /* One row, scrolled sideways, never wrapped. Five recent playlists
         wrapped is three rows on a phone, and three rows here is the Start
         button below the fold for the host this was built to save time. The
         padding is room for the focus ring and the press, which a scrolling
         box would otherwise clip; the margin gives it back. */
      .chip-row {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        padding: 3px;
        margin: -3px;
      }
      .chip-row::-webkit-scrollbar { display: none; }
      .chip-row-label {
        flex: 0 0 auto;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted, #777);
      }

      .chip {
        flex: 0 0 auto;
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        max-width: 220px;
        min-height: 36px;
        padding: 6px 13px;
        border-radius: 999px;
        border: 1.5px solid var(--border, #2a2a2a);
        background: var(--surface2, #222);
        color: #bbb;
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        font-weight: 500;
        line-height: 1.3;
        text-align: left;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
      }
      @media (hover: hover) { .chip:hover { border-color: #444; color: var(--text, #f0f0f0); } }
      .chip:active { transform: scale(0.96); transition: none; }
      .chip:focus-visible { outline: 2px solid var(--green, #1DB954); outline-offset: 1px; }
      /* The chip whose playlist is the one in the field. A link is 22
         characters nobody can read; this is what says which playlist it is. */
      .chip.current { border-color: var(--green, #1DB954); color: var(--green, #1DB954); }
      .chip.with-blurb { border-radius: 12px; padding: 7px 13px; }
      .chip-name,
      .chip-blurb {
        display: block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip-blurb { font-size: 11px; font-weight: 400; color: #888; }

      /* Under a refusal, and under the editorial warning: the next step and
         the way to the guide. The colour is the box's own, so one rule serves
         the red box and the amber warning. */
      .help-step { margin-top: 6px; }
      .help-link {
        color: inherit;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
        white-space: nowrap;
        padding: 6px 0;
      }
      @media (hover: hover) { .help-link:hover { opacity: 0.8; } }
      .help-link:active { opacity: 0.6; transition: none; }
      .help-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 2px; }

      .editorial-warning {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.5;
        color: #f59e0b;
      }
    `}</style>
  );
}

/**
 * Why the form is full, and the way to empty it.
 *
 * Said out loud because a form that arrives filled in with names is only
 * helpful to the person whose names they are. On a laptop passed around a
 * room the next host is looking at somebody else's playlist and somebody
 * else's friends, and needs to be told both where it came from and that it is
 * one tap from gone.
 */
export function RecallNote({
  onStartFresh,
  locked,
}: {
  onStartFresh: () => void;
  /** A room is open or a start is in flight: the way out is withheld. */
  locked: boolean;
}) {
  return (
    <p className="recall-note fade-in fade-in-2">
      <span>Filled in from your last game here.</span>
      {/* Hidden, not removed, while it is locked. Taking the whole line away
          would move the card — and the Start button under the host's thumb —
          by its height at the moment Start is pressed, and back again if the
          playlist is refused. */}
      <button
        type="button"
        className="text-link"
        onClick={onStartFresh}
        disabled={locked}
        aria-hidden={locked}
        style={locked ? { visibility: "hidden" } : undefined}
      >
        Start fresh
      </button>
    </p>
  );
}

export interface PlaylistChip {
  id: string;
  name: string;
  /** Starters carry one; recent playlists do not. */
  blurb?: string;
}

export function PlaylistChips({
  label,
  caption,
  playlists,
  currentId,
  onPick,
}: {
  /** Names the group for a screen reader, and heads the row when there is no caption. */
  label: string;
  /** A sentence above the row, in place of the label at its head. */
  caption?: string;
  playlists: readonly PlaylistChip[];
  /** The id of the playlist in the field, if it is one of these. */
  currentId?: string | null;
  onPick: (playlist: PlaylistChip) => void;
}) {
  if (playlists.length === 0) return null;
  return (
    <div className="chip-block">
      {caption && <p className="chip-caption">{caption}</p>}
      <div className="chip-row" role="group" aria-label={label}>
        {!caption && (
          <span className="chip-row-label" aria-hidden>
            {label}
          </span>
        )}
        {playlists.map((playlist) => {
          const current = playlist.id === currentId;
          return (
            <button
              key={playlist.id}
              type="button"
              className={`chip${current ? " current" : ""}${playlist.blurb ? " with-blurb" : ""}`}
              aria-pressed={current}
              title={playlist.name}
              onClick={() => onPick(playlist)}
            >
              <span className="chip-name">{playlist.name}</span>
              {playlist.blurb && <span className="chip-blurb">{playlist.blurb}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The step and the link, under whatever sentence came before them.
 *
 * The link opens in a new tab, and that is not a style choice. The form is
 * React state: a host who has typed six names, been refused, and followed a
 * same-tab link to the guide comes Back to an empty form, because nothing is
 * remembered until a game has started. The guide is there to get them past
 * the refusal, not to cost them the rest of the setup.
 */
export function PlaylistHelpLine({ help }: { help: PlaylistHelp }) {
  return (
    <p className="help-step">
      {help.step}
      {help.href && (
        <>
          {" "}
          <a className="help-link" href={help.href} target="_blank" rel="noopener">
            {help.label} →
          </a>
        </>
      )}
    </p>
  );
}

/** Under the field, the moment the link in it is one of Spotify's own. */
export function EditorialWarning({ warning }: { warning: { notice: string } & PlaylistHelp }) {
  return (
    // `status`, not `alert`: it appears while the host is still typing, and
    // an alert would cut across whatever a screen reader was saying to
    // announce something that is not yet a failure.
    <div className="editorial-warning" role="status">
      <p>⚠ {warning.notice}</p>
      <PlaylistHelpLine help={warning} />
    </div>
  );
}
