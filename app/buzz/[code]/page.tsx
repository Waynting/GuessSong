"use client";

/**
 * Player side of Buzzer Mode, and — when the host's room also collects
 * playlists — the only page a player ever sees.
 *
 * `/j/[code]` still exists for Mixed Playlist Mode *without* buzzers, where
 * there is no socket and a one-shot form is the whole interaction. This page is
 * the superset: it holds the live socket, and makes the same single POST to the
 * mailbox on the side when `?p=1` says the room has one.
 *
 * That flag is a hint for this form, not a permission — the mailbox is what
 * validates a submission, so a player who strips it just doesn't get asked.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BuzzerButton } from "@/components/buzzer-button";
import { useBuzzerSocket } from "@/lib/use-buzzer-socket";
import { JOIN_WANTS_PLAYLIST_PARAM } from "@/lib/room-client";
import { trackEvent } from "@/lib/analytics";
import { apiError, buzzerErrorMessage, describeError } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { readStored, removeStored, writeStored } from "@/lib/host-session";
import { LoopCtaButton, LoopFooter } from "@/components/loop-cta";

const NAME_STORAGE_KEY = "guesssong_player_name";

/**
 * Remembers that this browser already fed the mailbox for a given room. Without
 * it, a phone that locks and reconnects would be asked for a playlist again —
 * and the mailbox refuses a second submission under the same name, so the
 * player would be stuck on a form they cannot get past.
 */
function submittedKey(code: string): string {
  return `guesssong_submitted_${code}`;
}

export default function BuzzPlayerPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [ready, setReady] = useState(false);
  /** Whether this room wants a playlist from us, and hasn't had one yet. */
  const [wantsPlaylist, setWantsPlaylist] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // The player's phone, not the host's screen, decides what language this page
  // fails in — they scanned a QR and may not share a language with the host.
  const locale = useErrorLocale();
  // Read from the URL rather than rendered from it, so the form doesn't flash
  // its short version before the query string is known.
  const [hydrated, setHydrated] = useState(false);
  // One landing per page load, like joinedRef below. This event is the room
  // funnel's denominator, so a second fire doesn't just add noise — it deflates
  // every conversion rate measured against it.
  const openedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Both reads guarded: a locked-down browser throws on the property access,
    // and this effect runs on landing, before the form has rendered — an
    // unguarded read was "The game stopped" in place of Join Room. See
    // lib/host-session.ts.
    const needsPlaylist =
      params.get(JOIN_WANTS_PLAYLIST_PARAM) === "1" &&
      readStored(submittedKey(code)) !== "1";
    setWantsPlaylist(needsPlaylist);

    // Remember the name so a reconnect (or a locked phone coming back) doesn't
    // dump the player onto a form mid-round. A room still owed a playlist is
    // the one case where we stop anyway — there is a second field to fill.
    const saved = readStored(NAME_STORAGE_KEY);
    if (saved) {
      setDraft(saved);
      if (!needsPlaylist) {
        setName(saved);
        setReady(true);
      }
    }
    setHydrated(true);

    // Fires for every landing, including the ones that go no further. Paired with
    // buzz_player_joined it gives the scan → in-the-room rate; buzz_player_joined
    // alone only ever counts the phones that made it.
    if (!openedRef.current) {
      openedRef.current = true;
      trackEvent("room_join_opened", { join_page: "buzz", wants_playlist: needsPlaylist });
    }
  }, [code]);

  const joinedRef = useRef(false);
  const { snapshot, connected, error, playerId, buzz, reconnect } = useBuzzerSocket({
    code: ready ? code : null,
    name,
  });

  useEffect(() => {
    if (!snapshot || joinedRef.current) return;
    joinedRef.current = true;
    trackEvent("buzz_player_joined", { player_count: snapshot.players.length });
  }, [snapshot]);

  async function handleJoin() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setJoinError(null);

    if (wantsPlaylist) {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/room/${code}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName: trimmed, playlistUrl }),
        });
        const data = await res.json();
        // 410 means the host already built the pool. The playlist half of this
        // room is over, but the buzzers run all game — so a latecomer scanning
        // the same code still gets a buzzer instead of a dead end.
        //
        // 409 `room_name_taken` is, most often, the mailbox's own memory of
        // this phone: it submitted once, then lost the flag below (a browser
        // that refuses storage keeps nothing across a reload) and asked
        // again. The playlist is in the pool, so the player carries on to the
        // buzzer as on a 410 rather than into the dead end the flag exists to
        // prevent. The mailbox cannot tell that apart from a second guest
        // with the same name, so nothing is written on this path: the flag
        // and the form's playlist stay as they are, and if the room refuses
        // the socket join as `name_taken` the form re-asks for name *and*
        // playlist, with the URL still in it.
        const failure = res.ok ? null : apiError(data, "room_submit_failed");
        const alreadyIn = res.status === 409 && failure?.code === "room_name_taken";
        if (failure && res.status !== 410 && !alreadyIn) throw failure;
        if (res.ok) {
          trackEvent("room_submission_sent", {
            submitted_by: "player",
            track_count: data.trackCount,
          });
        } else {
          // Still a fall-out from the pool, even though the player carries on to
          // a working buzzer and sees no error.
          trackEvent("room_submission_failed", {
            submitted_by: "player",
            reason: alreadyIn ? "already_in" : "too_late",
          });
        }
        if (!alreadyIn) {
          writeStored(submittedKey(code), "1");
          setWantsPlaylist(false);
        }
      } catch (e: unknown) {
        trackEvent("room_submission_failed", { submitted_by: "player", reason: "other" });
        setJoinError(describeError(e, locale, "room_submit_failed"));
        return;
      } finally {
        setSubmitting(false);
      }
    }

    writeStored(NAME_STORAGE_KEY, trimmed);
    setName(trimmed);
    setReady(true);
  }

  if (!hydrated) return null;

  if (!ready) {
    const isValidUrl =
      playlistUrl.includes("spotify.com/playlist") ||
      playlistUrl.includes("spotify:playlist:");
    const canJoin = draft.trim().length > 0 && (!wantsPlaylist || isValidUrl) && !submitting;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold">Join {code}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {wantsPlaylist
                ? "Add your playlist and grab a buzzer — one step, and no one else sees your playlist."
                : "Enter your name — the host's screen shows who buzzed first."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !wantsPlaylist && handleJoin()}
              placeholder="Player name"
              maxLength={24}
              autoFocus
            />
          </div>
          {wantsPlaylist && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="playlist">Your Spotify Playlist</Label>
              <Input
                id="playlist"
                type="url"
                placeholder="https://open.spotify.com/playlist/..."
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}
          <Button onClick={handleJoin} disabled={!canJoin}>
            {submitting ? "Submitting..." : wantsPlaylist ? "Submit & Join" : "Join Room"}
          </Button>
          {joinError && <p className="text-sm text-destructive">{joinError}</p>}
          {/* The calmest screen on this phone: the player has just scanned a
              code, the room has not started, and they are reading. It is the
              only moment here that is not competing with a song. */}
          <LoopFooter surface="buzz_footer" />
        </div>
      </main>
    );
  }

  // Dead ends — retrying the same socket will fail the same way, so say so
  // rather than leaving the player staring at a button that will never work.
  // A taken name has a way out (another name) and a room that never
  // answered has one (try again, from a clean socket); the rest are the
  // room's or the site's to fix.
  const fatal =
    error &&
    (error.code === "name_taken" ||
      error.code === "room_expired" ||
      error.code === "room_full" ||
      error.code === "unreachable" ||
      error.code === "not_configured" ||
      error.code === "no_answer");
  if (fatal) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="flex w-full max-w-sm flex-col gap-4 text-center">
          {/* The Worker's own `message` is English and only a fallback — the
              code is what this phone renders in its own language. */}
          <p className="text-lg font-semibold text-destructive">
            {buzzerErrorMessage(error, locale, "player")}
          </p>
          {error.code === "name_taken" && (
            <Button
              variant="secondary"
              onClick={() => {
                removeStored(NAME_STORAGE_KEY);
                setReady(false);
                joinedRef.current = false;
              }}
            >
              Try a different name
            </Button>
          )}
          {error.code === "no_answer" && (
            <Button variant="secondary" onClick={reconnect}>
              Try again
            </Button>
          )}
          {/* A dead end by definition — the room is gone, full or out of
              reach, or the name is taken. Somewhere to go is worth more here
              than on any working screen. */}
          <LoopFooter surface="buzz_footer" />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col gap-3 bg-background p-3 text-foreground">
      <header className="flex items-center justify-between px-1 text-sm">
        <span className="font-semibold">{name}</span>
        <span className="text-muted-foreground">
          {connected ? `Room ${code}` : "Connecting…"}
          {snapshot ? ` · ${snapshot.players.length} in room` : ""}
        </span>
      </header>

      <BuzzerButton
        phase={snapshot?.phase ?? "idle"}
        buzzes={snapshot?.buzzes ?? []}
        playerId={playerId}
        connected={connected}
        onBuzz={buzz}
      />

      <p className="px-1 text-center text-xs text-muted-foreground">
        Buzz the moment the clip starts, then shout the answer.
      </p>

      {/*
        Between rounds only, and never before the first round has resolved —
        a player who has not yet buzzed at anything has no idea what this app
        does and is the wrong person to ask.

        `roundIndex` is the right signal and `phase` transitions are not:
        `handleResolve` in the Worker reaches `idle` from both `open` and
        `locked`, so a round nobody buzzed at looks identical to one that was
        answered. `roundIndex` advances only on `host:next`
        (worker/src/buzzer-room.ts), which is exactly "a round finished".
        Reading it off the snapshot rather than a ref also means it survives a
        reconnect, where the whole snapshot is adopted wholesale.

        Rendered always and hidden when inactive so it can never reflow the
        buzz button underneath someone's thumb.
      */}
      <div className="px-1 pb-1">
        <LoopCtaButton
          surface="buzz_cta"
          active={snapshot?.phase === "idle" && (snapshot?.roundIndex ?? 0) >= 1}
        />
      </div>
    </main>
  );
}
