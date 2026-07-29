# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-29

### Added

- **Buzzer Mode** — every player gets a buzzer on their own phone, so the host can stop refereeing "who said it first" and play too. Opt-in per game, and only offered when `NEXT_PUBLIC_BUZZER_WS_URL` is set, so merging this ships it dark.
  - Runs as a **Cloudflare Worker + Durable Object** (`worker/`), separate from the Next.js app on Vercel. The whole game hinges on "who pressed first" being one atomic server-side decision; a DO is single-threaded and addressed by room code, so every phone in a party reaches the same instance and the buzz handler runs to completion without another buzz interleaving. No lock, no CAS, no retry loop. Vercel can't host this itself — its WebSocket connections aren't guaranteed to land on the same function instance, so there'd be nothing to broadcast a room to. Reverses Premise 3 ("no realtime layer") of `dev_docs`' 2026-07-29 design doc.
  - Player page at `/buzz/[code]`: live socket, buzz button, queue position. Identity is a `playerId` in localStorage rather than the socket, so a phone that locks, drops Wi-Fi, or backgrounds reconnects into the same seat.
  - The host buzzes too, from the game screen, with **space** as their buzzer — they're already at the keyboard running clips, and making them pick up a second device was the thing this feature exists to stop.
  - Wrong answers pass the question down the buzz queue instead of ending the round.
  - The scoreboard is driven by whoever actually joined the room (`mergeRoomRoster`), additive only, so a player who drops out keeps the points they earned.
  - New telemetry shaped to answer questions that need n≈4000 rather than n=1: `buzz_received`, `buzz_round_resolved`, `buzz_player_joined`, and `peak_phone_count` on `game_finished`.
  - New modules: `lib/buzzer-protocol.ts` (wire types, imported verbatim by both sides of the network boundary), `lib/buzzer-client.ts`, `lib/use-buzzer-socket.ts`, `components/buzzer-button.tsx`, `components/buzzer-host-panel.tsx`.
- **One room, one code, one QR.** Buzzer Mode and Mixed Playlist Mode were two independent room systems, and a game could end up using both — players scanned twice, for two different codes, on two different pages. They now share a single code.
  - Sharing was rejected earlier for a real reason: the playlist code is shown to every player, and the Worker hands its host token to whoever POSTs a code first, so any guest could have claimed the buzzers. That dies if the host claims the Durable Object **first**, opens the Upstash mailbox under that same code second, and only then shows it — the code is never public before the host holds the DO. That ordering lives in `lib/room-client.ts` and a test asserts the call order, not just the result.
  - `createRoom()` takes an optional requested code; a code already in use is a `409`, never a silent join into someone else's mailbox.
  - The join link routes to `/buzz/[code]` when there is a buzzer, with `?p=1` when the room also collects playlists — a hint for the form, not a permission. `/j/[code]` still serves Mixed-without-buzzer unchanged.
  - `components/room-panel.tsx` replaces both former lobbies and merges its roster from the live socket and the mailbox poll.
- **The host can add their own playlist** in Mixed Playlist Mode's QR flow. Everyone else contributes by scanning the code on the host's screen, which the host cannot do — they *are* the screen. Missing since the mode shipped; they either sat out of their own party's pool or had to open the join link on a second device.
- **A clip transport for the host**: buzzing in pauses the music so the room can hear the answer, and `Resume` / `Stop` / `Replay` stay available until `Reveal Answer` ends the round.

### Changed

- The room step moved to the **bottom** of the setup page, after every setting. The code is what turns a configured game into a gathering, and printing it before the clip length was even picked meant people scanned into a room whose settings were still moving.
- Mixed Playlist Mode's start gate counts **playlists**, not players, and the host's own contribution counts toward it — so one guest plus the host is a startable 2-player mix. "Waiting for 1 more player" read as "wait for another guest" when what was missing was the host's own playlist.
- The game page uses **one corner radius** (`--radius`, 12px) for every rectangular surface and control; it had been five values picked per element plus Tailwind's `rounded`/`lg`/`xl`/`2xl` in the host panel. Only the circular avatar and the 2px progress hairline are exempt.
- The buzzer verdict buttons are content-sized and centred. `Correct +3` was `flex: 1`, so beside a content-sized `Wrong` it ballooned across the card and read as a different class of control.
- The early-buzz penalty was removed rather than made reachable — the buzzer is disabled while the round is idle, so it could never fire.

### Fixed

- `parseGamePayload` rewrote any unrecognised `GameMode` to `"party"`, so a buzzer game silently downgraded to a party game on sessionStorage round-trip with no error anywhere. Replaced with an `isGameMode()` allow-list, matching the `isPlaylistSource()` pattern one line above.
- The host held **two** WebSockets and double-counted every buzz. A "closed" flag shared across effect runs raced on remount; the room deduped the sockets by `playerId` so the phone count looked right, while every analytics event fired twice. All three telemetry curves would have been inflated ~2× and looked plausible enough to act on.
- A wrong room code hung on "connecting" forever. Unknown rooms are refused at the WebSocket upgrade (404), so the socket never opens and the server's `room_expired` message has no transport to arrive on. Never-opened closes are now counted instead.
- `reveal()` resolved the room's round, and the room only accepts a verdict while `locked` — so the exact moment the host started scoring was the moment `Correct` and `Wrong` became silent no-ops.
- `Wrong` left the eliminated player on screen: the reducer treated a known buzz entry that isn't at the head as a duplicate replay rather than a queue advance.
- Buzzer players scored nothing. Names typed at setup fed the scoreboard while names typed on each phone fed the room, and `awardPoint` matches by name — two name spaces that silently drifted apart. They now merge, case-insensitively, since the room already refuses a second "amy" while "Amy" is connected.
- `snapshot?.buzzes ?? []` in a hook dependency minted a fresh array every render, an infinite loop in the first second of every buzzer game. Now `useMemo`.
- The join URL was built from `NEXT_PUBLIC_BASE_URL`, which points at production — so a Vercel preview printed a QR code sending every player to a deployment where the room, and on a feature branch the whole route, doesn't exist. Now `window.location.origin`.
- The end-of-clip deadline was a single `setTimeout` against wall clock, so pausing a 15s clip at 8s would have ended it while still paused and resuming would have finished it instantly. Clip time is now accounted in segments.
- `Replay` didn't clear the running timers before restarting, so a replayed clip could be cut short by the deadline from the run before it.
- The clip transport lost buttons as the phase flipped: `Replay` existed only in `guessing`, so resuming took it away, and the clip running out took `Resume`/`Stop` away. Both phases now render one identical row.
- The Worker refused Vercel preview origins. `ALLOWED_ORIGINS` supports `*` globs, anchored at both ends, where `*` cannot span a `/` — so `https://guesssong-*.vercel.app` can't be widened into `https://guesssong-x.vercel.app.evil.com` by a crafted `Origin` header.
- Neither Worker endpoint was rate limited; the `Origin` check was the only thing in front of them, and that is trivially satisfied by a script running on a page the Worker already allows. The WebSocket upgrade was therefore an unmetered oracle for "does this room code exist", and a 4-character code from a 31-character alphabet is only ~923k combinations. Both endpoints now throttle per `CF-Connecting-IP` (Cloudflare's own header, which a client can't forge, unlike `X-Forwarded-For`) via Workers' `ratelimits` bindings: 60 joins/min, enough for a whole party arriving at once behind one Wi-Fi NAT plus reconnect backoff, and 15 room creations/min. The upgrade is checked *before* `getByName()`, so a code-guessing sweep can't instantiate a Durable Object per guess on its way to being refused.

### Known gaps

- **Buzzer Mode has never been tested on a real phone.** The entire value is on phones; `onPointerDown` timing, `navigator.vibrate`, and iOS long-press suppression have only ever been exercised with synthetic pointer events. No game has been played through to the finish screen with buzzers either.
- Host and player on the *same device* share one `playerId` and collide. Harmless in the real setup (host on a laptop, players on their own phones), but a host who opens the player page to test will break their own session.
- The host's space-bar buzzer is ignored while a button has focus, because space is that button's own activation. A host who clicks `Resume` with the mouse and then reaches for space will press `Stop` instead of buzzing.
- Room codes stay 4 characters from a 31-character alphabet (~923k combinations), chosen so a code is still shoutable across a room. Collisions are detected and retried on both backends, and enumeration is now metered per IP rather than lengthened — but a determined attacker with many IPs still has a smaller space to walk here than a 6-character code would give.
- The host's room state still lives only in React state — a page reload before starting the game orphans the room, now including the buzzer half.

## [0.2.0] - 2026-07-12

### Added

- **Mixed Playlist Mode** (v0–v2 of `dev_docs/guessong-mixed-playlist-spec.md`; v3 async quiz mode not started):
  - **v0 — Pass This Phone**: zero-backend flow where players take turns entering their name + Spotify playlist URL on the host's device, with a masked "✓ added" confirmation between turns. Capped at 12 contributors with duplicate-name rejection, matching the server room's limits.
  - **v1 — QR Code / Share Link room**: host creates a room (`POST /api/room`), players submit playlists via `/j/[code]` by scanning a QR code or receiving a shared link (`Share Join Link` button — same URL either way), host polls submission status and pulls the pooled tracks to start (`GET /api/room/[code]/pool`). Rooms are TTL'd (30 min) and gated behind at least 2 contributors. Backed by Upstash Redis in production, in-memory fallback for local dev. All four room routes are rate-limited per IP.
  - **v1.5 — Guess-the-source scoring**: host scoring panel gained a third dimension, "+2 for guessing whose playlist a track came from." Every player is eligible, including the track's own contributor(s) — sampling means a contributor doesn't know which of their tracks made the pool, so they may not recognize their own track any faster than anyone else.
  - **v2 — Group taste card**: a downloadable "Save Taste Card" image (alongside the existing "Save Results") showing shared tracks across playlists, "Most Obscure Taste," and "Most Mainstream" awards.
  - New shared modules: `lib/mixed-playlist.ts` (cross-playlist fingerprint dedupe + fair per-contributor sampling), `lib/room.ts` + `lib/kv.ts` (room lifecycle + KV abstraction), `lib/rate-limit.ts`, `lib/round-history.ts`, `lib/taste-card.ts`, `lib/result-image.ts` (shared canvas card rendering).
  - `Track.contributors` and `Track.popularity` added to the shared track shape; `GamePayload.mixedPlaylistMeta` added for pool provenance.

### Fixed

- `parseGamePayload`'s `playlistSource` fallback used a binary ternary (`"builtin" : "own"`) that would have silently misclassified the new `"mixed"` source as `"own"` on sessionStorage round-trip; replaced with an allow-list check.
- `submitToRoom`/`consumeRoomPool` read-modify-wrote the whole room record with no atomicity — two players submitting close together could silently clobber each other, and a submission racing a host's "Start" could un-consume an already-started room. Both now re-read the record immediately before writing and retry on a lost write instead of failing silently.
- `GET /api/room/[code]/status` and `GET /api/room/[code]/pool` had no rate limiting, unlike the other two room routes — an unthrottled client could enumerate the ~1M possible 4-char room codes and read active rooms' player names. Both now rate-limit per IP.
- Room submissions stored the full raw Spotify API blob (`Track.rawJson`) per track; a full room could approach Upstash's per-value size limit and made every submission's write cost grow with room size. Submissions are now stripped before storage via the same `stripTrackForStorage` helper already used for sessionStorage.
- `computeMostObscure` credited every contributor of a shared (multi-contributor) track whenever any correct source guess was made, even though the game has no record of which specific contributor was named — inflating the "Most Obscure Taste" stat for tracks that appear in multiple playlists. Now only single-contributor tracks count toward this award.
- `downloadTasteCard`'s canvas height was hardcoded assuming both taste-card awards always render; when only one (or neither) applies, the shared image left unexplained blank space. Height now reflects the actual award count.
- Room-full submissions returned `429` (rate-limit's status code) instead of `409` (conflict), making the two failure modes indistinguishable to a client.
- Host-token comparison in `consumeRoomPool` used `!==` instead of a constant-time comparison.

### Known gaps

- The spec's fourth taste-card award, "most often mistaken for someone else," is not implemented — the host-scoring UI only records whether a source guess was *correct*, never who was guessed instead when it was wrong. Would need a new scoring-UI step to compute.
- Manual "add track via search" fallback for non-Spotify users (KKBOX / YT Music / Apple Music) is deferred past v1's initial scope.
- `getClientIp` trusts the client-supplied `X-Forwarded-For` header verbatim; on a deployment where the edge doesn't strip/overwrite it, rate limits could be bypassed by rotating the header per request.
- The host's room state (`roomCode`/`hostToken`) lives only in React state — a page reload before starting the game orphans the room and any submissions already received.
