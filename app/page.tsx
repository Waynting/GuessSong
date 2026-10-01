"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { shuffle } from "@/lib/shuffle";
import { DEFAULT_SAMPLED_PER_PLAYER, type RoomSubmissionSummary, type RoomPoolResponse } from "@/types/room";
import { trackEvent } from "@/lib/analytics";
import { arrivedFrom } from "@/lib/loop-links";
import { bumpHostGameCount, recallLoopRef, rememberLoopRef } from "@/lib/host-session";
import { reportGameStart } from "@/lib/loop-client";
import type { MixedSubMode, SetupSource } from "@/lib/loop-stats";
import {
  AppError,
  apiError,
  describeError,
  shouldRememberAllRejections,
  shouldRememberRejection,
} from "@/lib/error-messages";
import {
  editorialWarning,
  failureFor,
  failureOf,
  playlistHelp,
  type SetupFailure,
} from "@/lib/playlist-help";
import { isEditorialLink, playlistIdOf, playlistUrlOf } from "@/lib/playlist-ref";
import { isSubmittablePlaylistLink } from "@/lib/spotify-link";
import {
  CLIP_DURATIONS,
  DEFAULT_CLIP_DURATION,
  MIXED_SAMPLE_COUNTS,
  PLAYER_NAME_MAX,
  chipsFor,
  forgetSetup,
  initialSetup,
  recallRecentPlaylists,
  recallSetup,
  rememberPlaylist,
  rememberSetup,
  type LinkSource,
  type RecentPlaylist,
  type SetupArrival,
  type SetupForm,
} from "@/lib/setup-memory";
import { STARTER_PLAYLISTS, starterPlacement } from "@/lib/starter-playlists";
import {
  EditorialWarning,
  PlaylistChips,
  PlaylistHelpLine,
  RecallNote,
  SetupAssistStyles,
} from "@/components/setup-assist";
import { useErrorLocale } from "@/lib/use-error-locale";
import { ServiceNotice } from "@/components/service-notice";
import { buildGamePayload, findDuplicateName } from "@/lib/game-session";
import { saveGame } from "@/lib/game-storage";
import { isBuzzerConfigured } from "@/lib/buzzer-client";
import type { OpenRoom } from "@/lib/room-client";
import { RoomPanel } from "@/components/room-panel";
import { QUIZ_SETUP_HREF, quizArrivalHref, requestedSetupMode } from "@/lib/setup-arrival";
import { SiteFooter } from "@/components/site-footer";
import { getGuide } from "@/lib/guides";
import { InstallBanner } from "@/components/install-banner";
import { CheckIcon, SetupBackdrop, SetupStyles, SpotifyIcon } from "@/components/setup-chrome";
import {
  MixedPlaylistCollector,
  type MixedContribution,
} from "@/components/mixed-playlist-collector";
import { mixedRosterKey, poolContributions } from "@/lib/mixed-playlist";
import {
  SONG_COUNTS,
  MAX_SONG_COUNT,
  DEFAULT_SONG_COUNT_STATE,
  selectPreset,
  typeCustom,
  commitCustom,
  isCustomSelected,
} from "@/lib/song-count";
import { MIXED_MIN_CONTRIBUTORS, startState, type SetupMode } from "@/lib/start-status";

// `CLIP_DURATIONS` and `MIXED_SAMPLE_COUNTS` were declared here until the form
// started remembering itself. They are in lib/setup-memory.ts now, because
// what is read back out of storage is validated against them: with a copy in
// each file, a remembered clip length could pass the check and then match no
// pill, and the Settings line would name a length the host cannot see selected.

/**
 * How many /api/playlist loads Mixed mode has in flight at once.
 *
 * One Start click fans out to one request per contributor — up to 12 — and
 * each of those pages through a playlist against a Spotify quota shared by the
 * entire site. Firing them all simultaneously is what put three POSTs inside
 * the same second in the production logs. Two at a time keeps the wall-clock
 * respectable while giving the server-side cache a chance to be warm for the
 * later ones, which matters whenever two friends contribute the same playlist.
 */
const MIXED_FETCH_CONCURRENCY = 2;

/**
 * Promise.allSettled with a ceiling on how many run at once. Results stay in
 * input order, because the caller maps rejections back to contributor names by
 * index to build its error message.
 */
async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run())
  );
  return results;
}

// Rendered on the page *and* emitted as FAQPage JSON-LD below — keep the two
// in sync, Google penalises schema that doesn't match visible content.
// The handful of guides linked from the homepage. Resolved through getGuide
// rather than retyped so the titles here cannot drift from the articles
// themselves; filtered so a retired slug costs a card instead of crashing the
// homepage. This is also the only inbound link a new guide gets from the
// highest-authority page on the site, which is what gets it crawled — so a
// newly published article is worth putting here for a while.
const HOME_GUIDES = [
  "how-to-host-a-music-quiz-night",
  "guess-the-song-game-rules",
  "best-playlists-for-a-guess-the-song-game",
  "spotify-playlist-not-working",
]
  .map((slug) => getGuide(slug))
  .filter((guide): guide is NonNullable<typeof guide> => Boolean(guide));

const FAQS: { q: string; a: string }[] = [
  {
    q: "How do you play the guess the song game?",
    a: "One person hosts on a single screen: paste a public Spotify playlist, add everyone's names, and the game plays a short clip from a random track. Everyone guesses out loud and the host taps whoever got it first — 3 points for the song, 1 more for the album.",
  },
  {
    q: "Do I need a Spotify account, and is it free?",
    a: "No login, no accounts and nothing to pay for — GuessSong is free and open source. It reads the track list from any public playlist link and plays a short preview of each song.",
  },
  {
    q: "Can everyone use their own playlist?",
    a: "Yes — that's Mixed Playlist Mode: everyone adds a playlist, GuessSong merges them into one pool, and you get a bonus point for guessing whose playlist a track came from. Turn on Buzzer Mode and players buzz in from their own phones instead of shouting.",
  },
  {
    q: "Which playlists work?",
    a: "Any public Spotify playlist link; private playlists and Spotify's own editorial ones (Discover Weekly and the like) can't be read. Spotify stopped providing preview clips for many tracks in 2024, so clips come from iTunes and Deezer, and the few songs with no preview anywhere are skipped.",
  },
];

// `SetupMode` and `MixedSubMode` are imported rather than redeclared here.
// `MixedSubMode` was a local copy with the same two members until the KV
// counters started keying off it, and a second copy of a union whose members
// become part of a key is the shape that drifts silently: the toggle would
// keep working, the counter would keep counting, and they would be counting
// different things. Same reason `lib/loop-links.ts` declares its surfaces
// once. `SetupMode` moved to `lib/start-status.ts` with the Start button's
// ladder, which is typed by it.

export default function SetupPage() {
  const router = useRouter();
  const [setupMode, setSetupMode] = useState<SetupMode>("single");
  const [playlistUrl, setPlaylistUrl] = useState("");
  /**
   * How the link in the field got there. Every path that writes the field
   * writes this beside it — typing, the restore, a chip, the share target —
   * and the game that starts reports whichever was last (`setup_source`). It
   * is state about the *field*, which is why typing one character over a
   * restored link makes it `typed`: the host has taken the link over.
   */
  const [linkSource, setLinkSource] = useState<LinkSource>("typed");
  const [players, setPlayers] = useState<string[]>(["", ""]);
  const [clipDuration, setClipDuration] = useState(DEFAULT_CLIP_DURATION);
  // Selected count + the custom field's text, moved together so the transitions
  // between them stay in lib/song-count.ts where the suite can reach them.
  const [songCount, setSongCount] = useState(DEFAULT_SONG_COUNT_STATE);
  // Buzzer Mode is opt-in per game, and only offered when the deployment has a
  // Worker to talk to — no point showing a toggle that can only fail.
  const [buzzerEnabled, setBuzzerEnabled] = useState(false);
  // One room, opened BEFORE the game starts so players have time to scan in,
  // and carrying whichever backends the chosen modes need. Null until the host
  // opens it, and never opened at all for the flows that need no phones.
  const [openedRoom, setOpenedRoom] = useState<OpenRoom | null>(null);
  const [buzzerPlayerCount, setBuzzerPlayerCount] = useState(0);
  const [mixedContributions, setMixedContributions] = useState<MixedContribution[]>([]);
  const [sampledPerPlayer, setSampledPerPlayer] = useState(DEFAULT_SAMPLED_PER_PLAYER);
  const [mixedSubMode, setMixedSubMode] = useState<MixedSubMode>("room");
  const [roomSubmissions, setRoomSubmissions] = useState<RoomSubmissionSummary[]>([]);
  const [roomStarting, setRoomStarting] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The sentence and the code it came from, together. The code is what lets
  // the box say what to do next; see `SetupFailure` in lib/playlist-help.ts.
  const [failure, setFailure] = useState<SetupFailure | null>(null);
  // Both empty until the mount effect has read storage: the page is
  // prerendered, and the server has no idea what this device remembers.
  const [recentPlaylists, setRecentPlaylists] = useState<RecentPlaylist[]>([]);
  const [recalled, setRecalled] = useState(false);
  /**
   * What the URL asked for on arrival. Kept because "Start fresh" means the
   * form this visit would have opened on had the device remembered nothing —
   * so a fresh start on `/?mode=mixed` stays on Mixed, and one on a shared
   * `?playlist=` keeps the link that was just shared.
   */
  const arrivalRef = useRef<SetupArrival>({ sharedUrl: null, requestedMode: null });
  const [mounted, setMounted] = useState(false);
  // Clip length, song count and the buzzer sit behind one summary line. Every
  // one of them has a default most hosts never touch, and laid out flat they
  // were three rows of pills between the playlist and the Start button.
  const [showSettings, setShowSettings] = useState(false);
  const locale = useErrorLocale();
  const firstInputRef = useRef<HTMLInputElement>(null);

  /**
   * The last submission that failed in a way the submission itself determines,
   * and the sentence the host was shown for it.
   *
   * Start is already disabled while a load is in flight, but a refused playlist
   * comes back from the negative cache in about 100ms, so the button re-enables
   * between mashes and every extra tap is another billed invocation that can
   * only replay the same refusal. Keyed on what was submitted — the URL for a
   * single playlist, the whole roster for a mix — so changing it needs no
   * explicit reset: the key simply stops matching.
   *
   * One ref rather than one per mode: the modes share a Start button, and a
   * host who switches mode has changed the question, so losing the other
   * mode's memo costs at most one request.
   *
   * It holds the whole failure, code included, so the replay is the same box
   * with the same help under it. Holding the sentence alone would make the
   * second press of Start the one that loses the link to the guide.
   */
  const lastRejectedRef = useRef<{ key: string; failure: SetupFailure } | null>(null);

  // What the one room has to do, given the modes picked above. Pass-the-phone
  // with the buzzer off needs no room at all, and never opens one.
  const collectsPlaylists = setupMode === "mixed" && mixedSubMode === "room";
  const needsRoom = collectsPlaylists || buzzerEnabled;

  function addMixedContribution(c: MixedContribution) {
    setMixedContributions((prev) => [...prev, c]);
  }

  function removeMixedContribution(idx: number) {
    setMixedContributions((prev) => prev.filter((_, i) => i !== idx));
  }

  /**
   * Discard a room whose jobs no longer match the chosen modes. Switching from
   * Mixed·QR to Single after opening a room would otherwise leave a mailbox
   * handle around that the new mode never reads, and — worse in the other
   * direction — a buzzer-only room in a mixed game whose code has no mailbox
   * behind it, so every scan lands on a form that cannot submit.
   */
  function resetRoom() {
    setOpenedRoom(null);
    setRoomSubmissions([]);
    setBuzzerPlayerCount(0);
    setRoomError(null);
  }

  /** The one way the mode link and the card header change the mode. */
  function chooseMode(mode: SetupMode) {
    setSetupMode(mode);
    resetRoom();
  }

  /**
   * Put a whole form on screen: the restore on arrival, and "Start fresh".
   * What the form *is* gets decided by `initialSetup` in lib/setup-memory.ts,
   * where the suite can reach it; this is only the wiring.
   *
   * The buzzer is the one field checked again here. It is remembered as a
   * switch, and whether the switch exists is a property of the deployment:
   * restoring "on" where `NEXT_PUBLIC_BUZZER_WS_URL` has since been unset
   * would hide the roster behind a room that can never open, with the toggle
   * that turns it back off hidden too.
   */
  const applySetup = useCallback((form: SetupForm) => {
    setSetupMode(form.setupMode);
    setMixedSubMode(form.mixedSubMode);
    setPlaylistUrl(form.playlistUrl);
    setLinkSource(form.linkSource);
    setPlayers(form.players);
    setClipDuration(form.clipDuration);
    setSongCount(form.songCount);
    setSampledPerPlayer(form.sampledPerPlayer);
    setBuzzerEnabled(form.buzzer && isBuzzerConfigured());
  }, []);

  /**
   * Forget what this device remembered and put the form back to what this
   * visit would have opened on without it.
   *
   * Withheld while a room is open (see where it renders): it can turn the
   * buzzer off, and a room with phones already in it is not something a link
   * this small should be able to throw away.
   */
  function startFresh() {
    forgetSetup();
    resetRoom();
    applySetup(initialSetup(arrivalRef.current, null));
    setRecentPlaylists([]);
    setRecalled(false);
    setFailure(null);
    lastRejectedRef.current = null;
  }

  /**
   * A chip was tapped. The field takes the playlist's canonical address, and
   * the error on screen goes with the link it was about — the host has just
   * done what the box told them to.
   */
  function pickPlaylist(id: string, source: LinkSource) {
    setPlaylistUrl(playlistUrlOf(id));
    setLinkSource(source);
    setFailure(null);
  }

  async function handleRoomStart() {
    if (!openedRoom?.playlistHostToken) return;
    setRoomError(null);
    setRoomStarting(true);
    try {
      const res = await fetch(
        `/api/room/${openedRoom.code}/pool?sampledPerPlayer=${sampledPerPlayer}`,
        { headers: { "x-host-token": openedRoom.playlistHostToken } }
      );
      const data: RoomPoolResponse & { error?: string } = await res.json();
      if (!res.ok) throw apiError(data, "room_start_failed");

      // Already open, and sharing this room's single code — the host claimed the
      // Durable Object before the code was ever shown, so there was nothing for
      // a guest to race for. See lib/room-client.ts.
      const room = openedRoom.buzzer;

      const payload = buildGamePayload({
        tracks: data.tracks,
        players: data.players.map((name) => ({ name, score: 0 })),
        playlistName: `${data.players.length}-Player Mix`,
        clipDuration,
        totalTracks: data.tracks.length,
        playlistSource: "mixed",
        mode: room ? "buzzer" : "party",
        mixedPlaylistMeta: {
          contributorNames: data.players,
          sampledPerPlayer: data.sampledPerPlayer,
        },
        ...(room ? { buzzerRoom: room } : {}),
      });
      // A browser that refuses to store this has not refused the playlist, and
      // must not be told it did. See lib/game-storage.ts.
      if (!saveGame(payload)) throw new AppError("storage_blocked");
      trackEvent("game_started", {
        player_count: data.players.length,
        clip_duration: clipDuration,
        song_count: data.tracks.length,
        playlist_source: "mixed",
        game_mode: room ? "buzzer" : "party",
        ...recordHostedStart("room"),
      });
      trackEvent("room_started", {
        contributor_count: data.players.length,
        unique_tracks: data.tracks.length,
      });
      // The switches and the settings, and nothing about who was in the room:
      // those names came off other people's phones. See lib/setup-memory.ts.
      rememberSetup({
        mode: "mixed",
        mixedSubMode: "room",
        sampledPerPlayer,
        clipDuration,
        buzzer: Boolean(room),
      });
      router.push("/game");
    } catch (e: unknown) {
      // The last step of the room funnel, and the one where a full room can still
      // end in no game at all — every playlist submitted and the pool refused.
      trackEvent("room_start_failed", { contributor_count: roomSubmissions.length });
      setRoomError(describeError(e, locale, "room_start_failed"));
    } finally {
      setRoomStarting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    // Read straight off `window.location`, not `useSearchParams`. This page is
    // a client component that is still statically prerendered — it carries the
    // FAQ structured data and takes essentially all of the site's traffic — and
    // an unsuspended `useSearchParams` would either fail the build or opt the
    // whole page out of prerendering. There is no Suspense boundary anywhere in
    // this app, and this is not the page to introduce one on.
    const query = new URLSearchParams(window.location.search);

    // Attribution from /r/[surface]. Stored rather than used immediately: the
    // person who just followed a call to action at someone else's party is not
    // about to host one tonight, so the game this credits is weeks away.
    const ref = query.get("ref");
    if (ref) rememberLoopRef(ref);

    // A link that asked for the quiz. `/?mode=quiz` was how the content pages
    // reached it while the quiz was a mode of this form, and `/?ref=quiz_result`
    // was the loop's warm arm landing here; both sit in old chats and cached
    // pages, so they are honoured with a redirect to the page the quiz has now.
    // The rule is in lib/setup-arrival.ts, and it is null for every other arrival.
    if (requestedSetupMode(query) === "quiz") {
      window.location.replace(quizArrivalHref(query));
      return;
    }

    // Everything else that fills the form on arrival, in one place: the share
    // target's `?playlist=` (/share → /?playlist=...), a `?mode=mixed` link,
    // and what this device remembers from its last game. Which of them wins
    // where they disagree is `initialSetup`'s rule, not this effect's — the
    // URL outranks the memory, both times.
    //
    // In an effect and not in the `useState` initialisers, for the reason the
    // query is: this page is prerendered, the server knows none of it, and a
    // first render that differed from the server's is a hydration mismatch on
    // the page that takes nearly all of the site's traffic.
    const arrival: SetupArrival = {
      sharedUrl: query.get("playlist"),
      requestedMode: requestedSetupMode(query),
    };
    arrivalRef.current = arrival;
    const remembered = recallSetup();
    applySetup(initialSetup(arrival, remembered));
    setRecalled(remembered !== null);
    setRecentPlaylists(chipsFor(recallRecentPlaylists(), remembered));
  }, [applySetup]);

  /**
   * Everything a hosted start owes the funnel, in one place.
   *
   * Called by the three paths that begin a real party — own playlist, mixed
   * pool, and the room variant. Any future path that is one person trying the
   * app rather than hosting for a room must stay out of it: counting those
   * would inflate the single number that answers whether anyone comes back.
   *
   * Has side effects: it advances the device's game counter and beacons the
   * new index to `/api/pulse`, which is the only path by which that number
   * reaches `npm run stats`. GA4 gets the same value as a param below.
   *
   * `mixed` names which route collected the playlists, and the two mixed
   * callers must pass it. It is the only way either of them appears in KV at
   * all: the `join_submitted` surface is rendered by `/j/[code]`, but
   * `roomJoinUrl` sends players to `/buzz/[code]` as soon as the buzzer is on,
   * and the phone route never shows a join page to anybody. Both were therefore
   * invisible to every counter, which is not the same as unused — and a
   * question `npm run stats` cannot answer is one nobody will answer.
   *
   * The setup source is derived here rather than passed, so the three callers
   * cannot disagree about it: a mixed game is `mixed` because it has no single
   * link, and every other game is however the link in the field got there.
   */
  function recordHostedStart(mixed?: MixedSubMode) {
    const hostGameIndex = bumpHostGameCount();
    const setupSource: SetupSource = mixed ? "mixed" : linkSource;
    reportGameStart(hostGameIndex, mixed, setupSource);
    return {
      host_game_index: hostGameIndex,
      arrived_from: arrivedFrom(recallLoopRef()),
      setup_source: setupSource,
    };
  }

  // Cosmetic only — the green check. Start is never gated on it: this form
  // and `/quiz` are the only ones that send a wrong link to the server, which
  // is what makes `playlist_invalid:*` countable (lib/spotify-link.ts).
  const isValidSpotifyUrl = isSubmittablePlaylistLink(playlistUrl);
  // The id begins `37i9`, which is the question the server asks before it
  // refuses — not "those four characters are somewhere in the text". See
  // lib/playlist-ref.ts.
  const isEditorial = isEditorialLink(playlistUrl);
  // Which playlist the field holds, for the chip that names it.
  const currentPlaylistId = playlistIdOf(playlistUrl);

  function addPlayer() {
    setPlayers((p) => [...p, ""]);
  }

  function removePlayer(idx: number) {
    setPlayers((p) => p.filter((_, i) => i !== idx));
  }

  function updatePlayer(idx: number, val: string) {
    setPlayers((p) => p.map((v, i) => (i === idx ? val : v)));
  }

  async function handleStart() {
    setFailure(null);
    const validPlayers = players.filter((p) => p.trim());
    if (!playlistUrl.trim()) {
      setFailure(failureFor("playlist_url_required", locale));
      return;
    }
    // Buzzer Mode has no manual roster to check — players name themselves as
    // they scan in, and the scoreboard fills from the room. Blocking on an
    // empty list here would make "Start Game" unreachable in the exact mode
    // that hides the list.
    if (!buzzerEnabled && validPlayers.length < 1) {
      setFailure(failureFor("players_required", locale));
      return;
    }
    // Scores are kept by name, so "Alex" and "alex" would score as one row.
    if (!buzzerEnabled && findDuplicateName(validPlayers) !== null) {
      setFailure(failureFor("players_duplicate_name", locale));
      return;
    }
    // Same link, same refusal. Re-show it rather than spending a request to be
    // told the identical thing — see `lastRejectedRef`. Deliberately silent
    // about the shortcut: from the host's side this is the error they are
    // already looking at, and the fix is still to change the link.
    const submissionKey = `own:${playlistUrl}`;
    const rejected = lastRejectedRef.current;
    if (rejected && rejected.key === submissionKey) {
      setFailure(rejected.failure);
      return;
    }
    setLoading(true);
    trackEvent("playlist_submitted", { playlist_source: "own" });
    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw apiError(data, "playlist_load_failed");

      const shuffled = shuffle(data.tracks as Track[]);
      const limited =
        songCount.count === "all" ? shuffled : shuffled.slice(0, songCount.count);

      // Opened from the room step before we got here, so players have already
      // had time to scan in. `undefined` when Buzzer Mode is off.
      const room = buzzerEnabled ? openedRoom?.buzzer : undefined;

      const payload = buildGamePayload({
        tracks: limited,
        // Empty in Buzzer Mode, even if the inputs still hold something. A host
        // who typed two names and then turned the toggle on would otherwise ship
        // rows nobody can claim: the section is hidden, so those names are
        // invisible, but they'd sit on the scoreboard all game next to the real
        // players the room reports.
        players: room ? [] : validPlayers.map((name) => ({ name, score: 0 })),
        playlistName: data.name,
        clipDuration,
        totalTracks: data.totalTracks,
        playlistSource: "own",
        mode: room ? "buzzer" : "party",
        ...(room ? { buzzerRoom: room } : {}),
      });
      // A browser that refuses to store this has not refused the playlist, and
      // must not be told it did. See lib/game-storage.ts.
      if (!saveGame(payload)) throw new AppError("storage_blocked");
      trackEvent("game_started", {
        // Phones that scanned in, plus the host, who buzzes from the game
        // screen. The typed count is 0 for every buzzer game, so reporting it
        // would quietly zero out the metric for the mode we care most about.
        player_count: room ? buzzerPlayerCount + 1 : validPlayers.length,
        clip_duration: clipDuration,
        song_count: limited.length,
        playlist_source: "own",
        game_mode: room ? "buzzer" : "party",
        ...recordHostedStart(),
      });
      // Remembered here — once the playlist has loaded and the game is stored
      // — and nowhere earlier: a link is worth keeping when it has worked, and
      // that is also the first moment its name is known. The roster is left
      // out of a buzzer game for the reason it is left out of the payload
      // above: the fields are hidden, so whatever they hold is not who played,
      // and writing it would replace the names the host typed last time.
      rememberSetup({
        mode: "single",
        playlistUrl,
        playlistName: data.name,
        ...(room ? {} : { players: validPlayers }),
        clipDuration,
        songCount: songCount.count,
        buzzer: Boolean(room),
      });
      rememberPlaylist(playlistUrl, data.name);
      router.push("/game");
    } catch (e: unknown) {
      const failed = failureOf(e, locale, "playlist_load_failed");
      // Only failures the URL itself determines are remembered. A throttled or
      // unknown one has to stay retryable — the host's link may be perfect and
      // the next attempt may well be the one that works.
      lastRejectedRef.current = shouldRememberRejection(e)
        ? { key: submissionKey, failure: failed }
        : null;
      setFailure(failed);
    } finally {
      setLoading(false);
    }
  }

  async function handleMixedStart() {
    setFailure(null);
    if (mixedContributions.length < MIXED_MIN_CONTRIBUTORS) {
      setFailure(
        failureFor("mixed_min_contributors", locale, { count: MIXED_MIN_CONTRIBUTORS })
      );
      return;
    }
    // Same roster, same refusal — the single-playlist reasoning one flow over,
    // except a mash here re-fires one request per contributor rather than one.
    const submissionKey = `mixed:${mixedRosterKey(
      mixedContributions.map((c) => c.playlistUrl)
    )}`;
    const rejected = lastRejectedRef.current;
    if (rejected && rejected.key === submissionKey) {
      setFailure(rejected.failure);
      return;
    }
    /**
     * Whether every contributor that failed did so for a reason the link
     * itself decides. Computed inside the try, where the individual reasons
     * are still in scope, and read in the catch, where only the aggregate
     * `mixed_playlists_failed` survives — and that code is not evidence of
     * anything permanent on its own. See `shouldRememberAllRejections`.
     */
    let allFailuresFinal = false;
    setLoading(true);
    trackEvent("playlist_submitted", { playlist_source: "mixed" });
    try {
      const results = await settleWithConcurrency(
        mixedContributions,
        MIXED_FETCH_CONCURRENCY,
        async (c) => {
          const res = await fetch("/api/playlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: c.playlistUrl }),
          });
          const data = await res.json();
          if (!res.ok) {
            const err = apiError(data, "playlist_load_failed");
            // Carried so the summary below can tell "this playlist is broken"
            // apart from "Spotify is throttling the whole site".
            (err as AppError & { status?: number }).status = res.status;
            throw err;
          }
          return { playerName: c.name, tracks: data.tracks as Track[] };
        }
      );

      // A 429 is not the contributor's fault, and telling someone to "remove
      // or fix" a perfectly good playlist sends them straight back to retrying,
      // which is what keeps the shared quota spent. Surface the wait instead.
      const throttled = results.find(
        (r): r is PromiseRejectedResult =>
          r.status === "rejected" &&
          (r.reason as { status?: number } | undefined)?.status === 429
      );
      if (throttled) {
        // Rethrown whole rather than re-wrapped: the original carries the code
        // and its `{seconds}`, so the host reads the same wait their own
        // single-playlist start would have shown them, in their own language.
        throw throttled.reason instanceof AppError
          ? throttled.reason
          : new AppError("spotify_rate_limited");
      }

      const failedNames = results
        .map((r, i) => (r.status === "rejected" ? mixedContributions[i].name : null))
        .filter((n): n is string => n !== null);
      if (failedNames.length > 0) {
        allFailuresFinal = shouldRememberAllRejections(
          results
            .filter((r): r is PromiseRejectedResult => r.status === "rejected")
            .map((r) => r.reason)
        );
        throw new AppError("mixed_playlists_failed", { names: failedNames.join(", ") });
      }

      const contributions = (
        results as PromiseFulfilledResult<{ playerName: string; tracks: Track[] }>[]
      ).map((r) => r.value);
      const totalRawTracks = contributions.reduce((sum, c) => sum + c.tracks.length, 0);
      const pooled = poolContributions(contributions, sampledPerPlayer);
      const overlapCount = pooled.filter((t) => t.contributors.length > 1).length;

      // Pass-the-phone collects its players here on this screen, so the only
      // reason it opens a room at all is the buzzer.
      const room = buzzerEnabled ? openedRoom?.buzzer : undefined;

      const payload = buildGamePayload({
        tracks: pooled,
        players: mixedContributions.map((c) => ({ name: c.name, score: 0 })),
        playlistName: `${mixedContributions.length}-Player Mix`,
        clipDuration,
        totalTracks: pooled.length,
        playlistSource: "mixed",
        mode: room ? "buzzer" : "party",
        mixedPlaylistMeta: {
          contributorNames: mixedContributions.map((c) => c.name),
          sampledPerPlayer,
        },
        ...(room ? { buzzerRoom: room } : {}),
      });
      // A browser that refuses to store this has not refused the playlist, and
      // must not be told it did. See lib/game-storage.ts.
      if (!saveGame(payload)) throw new AppError("storage_blocked");
      trackEvent("game_started", {
        player_count: mixedContributions.length,
        clip_duration: clipDuration,
        song_count: pooled.length,
        playlist_source: "mixed",
        game_mode: room ? "buzzer" : "party",
        ...recordHostedStart("phone"),
      });
      trackEvent("mixed_pool_built", {
        contributor_count: mixedContributions.length,
        unique_tracks: pooled.length,
        total_raw_tracks: totalRawTracks,
        overlap_count: overlapCount,
      });
      // The switches and the settings only. The contributors are other
      // people's names and other people's playlists, typed into a phone that
      // was passed around. See lib/setup-memory.ts.
      rememberSetup({
        mode: "mixed",
        mixedSubMode: "phone",
        sampledPerPlayer,
        clipDuration,
        buzzer: Boolean(room),
      });
      router.push("/game");
    } catch (e: unknown) {
      const failed = failureOf(e, locale, "playlist_load_failed");
      // `allFailuresFinal` stays false for the throttled rethrow above and for
      // anything that failed before the per-contributor loop, so both remain
      // retryable — a shared quota clears on its own.
      lastRejectedRef.current = allFailuresFinal
        ? { key: submissionKey, failure: failed }
        : null;
      setFailure(failed);
    } finally {
      setLoading(false);
    }
  }

  const startBusy = loading || roomStarting;
  const startState_ = startState({
    setupMode,
    mixedSubMode,
    busy: startBusy,
    needsRoom,
    roomOpen: openedRoom !== null,
    buzzerEnabled,
    buzzerPlayerCount,
    mixedContributions: mixedContributions.length,
    roomSubmissions: roomSubmissions.length,
  });
  const startClick = setupMode === "single"
    ? handleStart
    : mixedSubMode === "phone"
    ? handleMixedStart
    : handleRoomStart;

  // What goes under the error's sentence: null for every failure that is not
  // the link's own fault, which is most of them and all of the throttling ones.
  const help = failure ? playlistHelp(failure.code, locale) : null;
  // Null while lib/starter-playlists.ts ships an empty list, so nothing below
  // that reads it renders.
  const starterPlace = starterPlacement({
    singleMode: setupMode === "single",
    fieldEmpty: !playlistUrl.trim(),
    recentCount: recentPlaylists.length,
    failureCode: failure?.code ?? null,
  });
  const starterChips = (
    <PlaylistChips
      label="Starter playlists"
      caption="No playlist handy? Try one of these"
      playlists={STARTER_PLAYLISTS}
      currentId={currentPlaylistId}
      onPick={(playlist) => pickPlaylist(playlist.id, "starter")}
    />
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQS.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          }),
        }}
      />
      <SetupStyles />
      <SetupAssistStyles />

      <SetupBackdrop />

      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px",
          position: "relative",
        }}
      >
        <div style={{ width: "100%", maxWidth: "480px" }}>
          {/* Header. One title, one line under it, and the language switch
              in the corner. It had an eyebrow, two taglines, a Chinese slogan,
              a "How to play" pill and a GitHub plea — six things before the
              form, on a page whose whole job is the form. The footer still
              links every one of those destinations. */}
          <div
            className={`text-center mb-8 ${mounted ? "fade-in fade-in-1" : ""}`}
            style={{ position: "relative" }}
          >
            {/* Crawl path to /zh. The href is the signal; the label is a
                switch, mirroring the "English" one on /zh. */}
            <a href="/zh" hrefLang="zh-TW" lang="zh-TW" className="lang-switch">
              中文
            </a>
            <div style={{ color: "#1DB954", display: "flex", justifyContent: "center", marginBottom: "10px" }}>
              <SpotifyIcon />
            </div>
            <h1 className="hero-title">GuessSong</h1>
            {/* This is an <h2>, not a <p>, so crawlers see the generic phrase
                people actually search for — the H1 is brand-only. */}
            <h2 style={{ color: "#666", fontSize: "15px", marginTop: "12px", fontWeight: 300 }}>
              Play a clip, guess the song — free, for any Spotify playlist, no login.
            </h2>
          </div>

          {/* Why the form is full, and the way to empty it. Above the card
              rather than in it: it is about the whole form, in either mode,
              and up here it costs the Start button 12px instead of a row.
              The way out is withheld while a room is open or a start is in
              flight — see `startFresh`. */}
          {recalled && (
            <RecallNote onStartFresh={startFresh} locked={openedRoom !== null || startBusy} />
          )}

          {/* Card */}
          <div
            className={`card ${mounted ? "fade-in fade-in-2" : ""}`}
            style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "24px", scrollMarginTop: "32px" }}
          >

            {/* The mode, when it is not the default. Single Playlist is
                what 95% of games are, so it gets no label and no pill: the
                card simply opens on it. Mixed is reached from the link under
                the Start button, and this header is the way back. */}
            {setupMode === "mixed" && (
              <div className="settings-row">
                <p className="section-label" style={{ marginBottom: 0 }}>Mixed Playlist</p>
                <button type="button" className="text-link" onClick={() => chooseMode("single")}>
                  ← Single playlist
                </button>
              </div>
            )}

            {setupMode === "single" && (
              <div>
                <p className="section-label">Spotify Playlist</p>
                <div style={{ position: "relative" }}>
                  <input
                    ref={firstInputRef}
                    type="url"
                    className={`url-input${isValidSpotifyUrl ? " valid" : ""}`}
                    placeholder="https://open.spotify.com/playlist/..."
                    value={playlistUrl}
                    onChange={(e) => {
                      setPlaylistUrl(e.target.value);
                      setLinkSource("typed");
                    }}
                    spellCheck={false}
                  />
                  {isValidSpotifyUrl && (
                    <span
                      style={{
                        position: "absolute",
                        right: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#1DB954",
                      }}
                    >
                      <CheckIcon />
                    </span>
                  )}
                </div>
                {/* It said "may not work". These are refused every time, so
                    it says so, and says what to do instead — before the host
                    has spent a Start finding out. */}
                {isEditorial && <EditorialWarning warning={editorialWarning(locale)} />}

                {/* The playlists this device has played, newest first; the
                    one in the field is lit, which is the only place on the
                    form a link has a name. One row, so five of them cost the
                    Start button the same height as one. With none, and an
                    empty field, the slot goes to the starters — a list that
                    ships empty. */}
                <PlaylistChips
                  label="Recent"
                  playlists={recentPlaylists}
                  currentId={currentPlaylistId}
                  onPick={(playlist) => pickPlaylist(playlist.id, "recent")}
                />
                {starterPlace === "field" && starterChips}
              </div>
            )}

              {/* Pass-the-phone collects playlists right here. The QR flow
                  collects them in the room step at the bottom instead, so
                  there is nothing to show for it this far up — the way
                  across to it sits under the room card. */}
            {setupMode === "mixed" && mixedSubMode === "phone" && (
                <div>
                  <p className="section-label">Collect Playlists</p>
                  <MixedPlaylistCollector
                    contributions={mixedContributions}
                    onAdd={addMixedContribution}
                    onRemove={removeMixedContribution}
                  />
                  <p style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setMixedSubMode("room");
                        resetRoom();
                      }}
                    >
                      Use a QR code instead →
                    </button>
                  </p>
                </div>
            )}

            {/* Players — the manual roster, and only when phones are not
                supplying one. Buzzer Mode makes this redundant: everyone types
                their own name as they scan in, and asking the host to type the
                same names again is how the two lists drifted apart and points
                went to players who did not exist. Mixed mode takes its roster
                from the contributors instead. */}
            {setupMode === "single" && !buzzerEnabled && (
                  <div>
                    <p className="section-label">Players</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {players.map((name, idx) => (
                        <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <input
                            type="text"
                            className="player-input"
                            placeholder={`Player ${idx + 1}`}
                            value={name}
                            onChange={(e) => updatePlayer(idx, e.target.value)}
                            maxLength={PLAYER_NAME_MAX}
                          />
                          {players.length > 1 && (
                            <button
                              className="remove-btn"
                              onClick={() => removePlayer(idx)}
                              aria-label={`Remove player ${idx + 1}`}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button className="add-player-btn" onClick={addPlayer}>
                        <span style={{ fontSize: "18px", lineHeight: 1, fontWeight: 300 }}>+</span>
                        Add Player
                      </button>
                    </div>
                  </div>
            )}

            {/* Settings — clip length, song count and the buzzer, behind one
                line that reads the current values. Everything here has a
                default, and the things a host must decide (playlist, players)
                come first. Buzzer Mode still swaps the roster for the room
                card when toggled from in here. Hidden entirely when
                NEXT_PUBLIC_BUZZER_WS_URL is unset, because without a Worker
                there is no room to open. */}
            <div>
              <p className="section-label">Settings</p>
              <div className="settings-row">
                <p className="settings-summary">
                  {[
                    `${clipDuration}s clips`,
                    setupMode === "mixed"
                      ? `${sampledPerPlayer} songs per player`
                      : songCount.count === "all"
                      ? "All songs"
                      : `${songCount.count} songs`,
                    ...(isBuzzerConfigured() ? [`Buzzer ${buzzerEnabled ? "on" : "off"}`] : []),
                  ].join(" · ")}
                </p>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setShowSettings((v) => !v)}
                  aria-expanded={showSettings}
                  aria-controls={showSettings ? "setup-settings" : undefined}
                >
                  {showSettings ? "Done ▴" : "Change ▾"}
                </button>
              </div>

              {showSettings && (
                <div
                  id="setup-settings"
                  style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "16px" }}
                >
                  {/* Clip Duration */}
                  <div>
                    <p className="section-label">Clip Duration</p>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {CLIP_DURATIONS.map((d) => (
                        <button
                          key={d}
                          className={`pill${clipDuration === d ? " active" : ""}`}
                          onClick={() => setClipDuration(d)}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Number of Songs — single-playlist mode only; mixed mode uses per-player sampling instead */}
                  {setupMode === "single" && (
                    <div>
                      <p className="section-label">Number of Songs</p>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                        {SONG_COUNTS.map((c) => (
                          <button
                            key={c}
                            className={`pill${songCount.count === c ? " active" : ""}`}
                            onClick={() => setSongCount(selectPreset(c))}
                          >
                            {c === "all" ? "All" : c}
                          </button>
                        ))}
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_SONG_COUNT}
                          className={`pill count-input${isCustomSelected(songCount) ? " active" : ""}`}
                          placeholder="Custom"
                          aria-label={`Custom number of songs, 1 to ${MAX_SONG_COUNT}`}
                          value={songCount.field}
                          onChange={(e) => {
                            // Read the value out before the updater, which React runs
                            // later: `e.target` is the live input, so a second
                            // keystroke landing first would make the callback read a
                            // different value than the event carried.
                            const raw = e.target.value;
                            setSongCount((s) => typeCustom(s, raw));
                          }}
                          onBlur={() => setSongCount(commitCustom)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Songs per Player — the mixed pool's cap, after duplicates are merged */}
                  {setupMode === "mixed" && (
                    <div>
                      <p className="section-label">Songs Per Player</p>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {MIXED_SAMPLE_COUNTS.map((c) => (
                          <button
                            key={c}
                            className={`pill${sampledPerPlayer === c ? " active" : ""}`}
                            onClick={() => setSampledPerPlayer(c)}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Buzzer Mode — the reason the host gets to play too. */}
                  {isBuzzerConfigured() && (
                    <div>
                      <p className="section-label">Buzzer Mode</p>
                      {/* Label says what the tap does, colour says what the state is.
                          A grey button reading "Off" was reporting status where a
                          control belongs — you couldn't tell whether it meant "it is
                          off" or "tap to turn it off". */}
                      <button
                        className={`pill${buzzerEnabled ? " active" : ""}`}
                        onClick={() => {
                          setBuzzerEnabled((v) => !v);
                          resetRoom();
                        }}
                        aria-pressed={buzzerEnabled}
                      >
                        {buzzerEnabled ? "✓ On" : "Turn on"}
                      </button>
                      <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
                        Everyone buzzes from their phone.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* The room — one code, one QR, doing whichever jobs the settings
                above ask for. Deliberately last: the code is what turns a
                configured game into a gathering, and printing it before the
                clip length was even picked meant people scanned into a room
                whose settings were still moving. Pass-the-phone with the
                buzzer off needs no room and shows nothing here. */}
            {needsRoom && (
              <div>
                <p className="section-label">Room</p>
                <RoomPanel
                  collectsPlaylists={collectsPlaylists}
                  buzzer={buzzerEnabled}
                  room={openedRoom}
                  onOpened={setOpenedRoom}
                  onPhoneCountChange={setBuzzerPlayerCount}
                  onSubmissionsChange={setRoomSubmissions}
                />
                {roomError && (
                  <p role="alert" style={{ marginTop: "10px", fontSize: "12px", color: "#fca5a5" }}>
                    {roomError}
                  </p>
                )}
                {collectsPlaylists && (
                  <p style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setMixedSubMode("phone");
                        resetRoom();
                      }}
                    >
                      Pass this phone around instead →
                    </button>
                  </p>
                )}
              </div>
            )}

            {/* Start Button. Whether it is live and the line under it are
                one rule, in lib/start-status.ts where the suite can reach it;
                only the wiring stays here — which handler, and the label. The
                button says what it does; what it is waiting for goes on the
                line under it. */}
            <div>
              <button className="start-btn" onClick={startClick} disabled={startState_.disabled}>
                {startBusy ? (
                  <>
                    <span className="spinner" />
                    Loading playlist
                    <span className="dot-pulse" />
                  </>
                ) : (
                  "Start Game →"
                )}
              </button>
              {startState_.status && <p className="start-status">{startState_.status}</p>}

              {/* `role="alert"`: a failed submit is announced, not just
                  painted. Without it a screen reader hears the button go
                  quiet and nothing else.

                  Under the sentence, for a link that will never load: what to
                  do next and where the guide explains it. The box used to be
                  the sentence alone. */}
              {failure && (
                <div
                  role="alert"
                  style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: "8px",
                    fontSize: "13px",
                    color: "#fca5a5",
                    lineHeight: 1.5,
                  }}
                >
                  <p>{failure.message}</p>
                  {help && <PlaylistHelpLine help={help} />}
                </div>
              )}
              {starterPlace === "refusal" && starterChips}

              {/* The other two ways in, as links rather than a pill row above
                  the form: one is 3% of games and the other is not a game and
                  has its own page. */}
              <div className="mode-links">
                {setupMode !== "mixed" && (
                  <button type="button" className="text-link" onClick={() => chooseMode("mixed")}>
                    Everyone brings a playlist? Mixed mode →
                  </button>
                )}
                {setupMode === "single" && <span className="mode-links-sep" aria-hidden>·</span>}
                <Link href={QUIZ_SETUP_HREF} className="text-link">
                  Make a Taste Quiz link →
                </Link>
              </div>
            </div>
          </div>

          {/* Install pitch — under the card, for hosts who have run a game
              before. It arrives after hydration, so it sits where its late
              arrival moves nothing the host is already reading. */}
          <InstallBanner />

          {/* Prose for search engines and first-time visitors alike. */}
          <section className="seo-section">
            <h2 className="seo-h2">What is GuessSong?</h2>
            <p className="seo-p">
              GuessSong is a free music guessing game for parties: paste any public
              Spotify playlist, and the host plays a short clip while everyone races to
              name the song. No login and no accounts — one screen and a room full of
              people is all you need.
            </p>
            <p style={{ marginTop: "14px" }}>
              <a href="/about" className="link-btn">See how to play →</a>
            </p>
          </section>

          <section className="seo-section">
            <h2 className="seo-h2">Frequently asked questions</h2>
            <div className="faq-list">
              {FAQS.map((faq) => (
                <div key={faq.q}>
                  <h3 className="faq-q">{faq.q}</h3>
                  <p className="faq-a">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* A few of the guides, deliberately not all of them — this is a
              teaser under a form, not a second index. HOME_GUIDES names which;
              the copy comes from lib/guides.ts so a retitled guide is retitled
              here too. (The count used to be written into this comment, and it
              went stale the first time a guide was added.) */}
          <section className="seo-section">
            <h2 className="seo-h2">Guides</h2>
            <p className="seo-p">
              Longer pieces on running one of these evenings — what to put on, how hard to
              make it, and what to do when Spotify refuses your link.
            </p>
            <div className="guide-links">
              {HOME_GUIDES.map((guide) => (
                <a key={guide.slug} href={`/guides/${guide.slug}`} className="guide-link">
                  <span className="guide-link-title">{guide.navTitle}</span>
                  <span className="guide-link-desc">{guide.description}</span>
                </a>
              ))}
            </div>
            <p style={{ marginTop: "14px" }}>
              <a href="/guides" className="link-btn">All guides →</a>
            </p>
          </section>

          <ServiceNotice />
          <SiteFooter />

        </div>
      </main>
    </>
  );
}
