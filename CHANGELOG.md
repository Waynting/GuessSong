# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`429 QUOTA_EXCEEDED` from Spotify on `/api/playlist`.** Nothing anywhere cached a playlist: `getPlaylistWithTracks` went to the network on every single call, so the same URL re-paginated in full on every host retry, every room submit, and for every player in a room who pasted the same link. Meanwhile Spotify's quota is per *client id* — one budget shared by the whole user base — while every limiter in `lib/rate-limit.ts` is keyed by IP, so N phones each got a fresh allowance against it. Five compounding causes, fixed together:
  - **`lib/playlist-cache.ts` (new)** — KV cache keyed by playlist id, 6h on a hit. A repeat load now costs zero upstream calls. Reads and writes are wrapped so a KV outage degrades to "slower", never "broken", the same contract `app/api/preview/route.ts` follows. This is not a reversal of the token cache's deliberate no-KV decision (`lib/spotify.ts`): a token has no fallback, a playlist does.
  - **In-flight coalescing** in the same module. One Mixed-mode Start fires a request per contributor and a QR room gets a burst of simultaneous submits; duplicate URLs in either used to mean duplicate pagination, because the cache write lands too late to help its own siblings.
  - **A 429 cooldown**, in KV so every lambda instance sees it. Without it a throttled window is self-sustaining — every host sees an error, every host retries, the retries keep the quota pinned. One 429 now parks all *uncached* loads for the duration Spotify asked for (clamped to 30s–15min); cached playlists keep serving, so a party already mid-game is unaffected by someone else's throttling.
  - **A proactive global budget** (`SPOTIFY_MAX_LOADS_PER_MINUTE`, default 40), a KV `incr` counter shared across instances. The cooldown above is reactive — it only helps once Spotify has already refused something. This is the half that stops us getting there: a spike, a scripted client, or a dozen rooms starting at once is refused here rather than spending the quota to find out. Counted in *loads*, not requests; one cold load is 1 metadata call plus up to 5 track pages, so the default works out to roughly 240 upstream requests a minute. Fails **open** on a KV error — losing the safety net has to mean "back to how it was", not "nobody can play".
  - **`limit=50` → `limit=100`** in `fetchPlaylistTracks`, Spotify's documented maximum. Every playlist was costing exactly twice the requests it needed to.
  - **`MAX_PLAYLIST_TRACKS = 500`**, replacing an unbounded `while (data.next)` loop. A 4,000-track playlist was 40 upstream requests for a game that then plays at most 50 of them.

### Added

- **Random sampling for oversized playlists.** A playlist longer than `MAX_PLAYLIST_TRACKS` is no longer read front-to-back: the first page reports the real length, and the rest of the page budget goes on randomly chosen pages spread across the whole playlist. Taking the first 500 of a 4,000-track playlist would mean the same songs every single game, and whatever the owner happened to add first. Sampling is by *page* rather than by track, because a page is what a request buys and sampling finer would cost more requests — the one thing this whole change exists to avoid. Page 0 is always among the candidates, since reading it is how the length is discovered, so the first 100 tracks are slightly over-represented; everything after them is uniform. Playlists that fit are still read whole and in order.
  - Sampled entries cache for 1h rather than 6h. The TTL is also how long everyone is stuck with the same draw, and six hours of it would undo the point of sampling.
  - `shuffle()` is Fisher-Yates. `Array#sort` with a random comparator, which the setup page still uses for its own shuffle, is not a uniform permutation.
- **Cache hit-rate instrumentation.** Hit/miss counters in KV, bucketed by day, held a week, readable via `getCacheStats()`. The running rate is logged on every *miss* rather than every load: once the cache is working, misses are the rare case, so the instrumentation gets quieter exactly as things get healthier and a sudden run of lines is itself the signal. Previously "did this work" could only be answered by the absence of 429s, which is indistinguishable from a quiet evening.

### Changed

- `getPlaylistWithTracks` ties its two concurrent calls to an `AbortController`. `Promise.all` rejects on the first failure and the route returns, but the losing half used to keep paginating afterwards — spending quota on a request nobody was waiting for, and emitting `console.error` with no request context. That is the whole explanation for "Spotify tracks fetch error" appearing under `/api/preview` in the production logs; `/api/preview` never called Spotify at all.
- `/api/playlist` returns **429 and 404 as themselves** instead of flattening every upstream failure into `400 + message`, and sets `Retry-After` on a 429. The client could not previously tell "your playlist is wrong" from "we are throttled", so the UI told throttled hosts to check their URL was public — sending them straight back into retrying against a spent quota. The 429 message now says the URL is fine and gives a wait.
- `submitToRoom` runs the duplicate-name and room-full checks against the record it already holds *before* fetching the playlist. Those rejections used to cost a full pagination and then answer 409. The authoritative re-check inside the write loop is unchanged; both now share `assertCanJoin`.
- Mixed mode's Start button loads contributor playlists two at a time (`MIXED_FETCH_CONCURRENCY`) instead of all 12 at once, and reports a 429 as a wait rather than as "remove or fix" the contributor's playlist.
- `/api/playlist` responses no longer carry `rawJson`. Every consumer already dropped it via `stripTrackForStorage`; keeping it made cache entries and response bodies roughly an order of magnitude larger than they needed to be.

### Known gaps

- `SPOTIFY_MAX_LOADS_PER_MINUTE`'s default of 40 is a guess. The right value depends on which quota tier the Spotify app is on, which the code cannot find out — hence the env var. Watch the hit-rate log for a week and tune.
- The global budget is a fixed window, so it can pass up to 2× the limit across a window boundary, same caveat as `lib/rate-limit.ts`. Acceptable: the cooldown catches the overshoot.
- `MAX_PLAYLIST_TRACKS` makes "All" mean "a random 500". Invisible for any playlist a party would realistically use, but it is a real behaviour change, and `truncated` is returned but not yet surfaced anywhere in the UI — a host with a 4,000-track playlist gets no indication they're playing a sample.
- Hit rate is logged and readable in-process but has no endpoint, so checking it means grepping Vercel logs. Deliberate: an endpoint would need an auth story for what is currently a two-line grep.

## [1.0.0] - 2026-07-30

The 1.0 line is drawn here rather than at a feature: the party game, Buzzer Mode,
Mixed Playlist Mode, the PWA and the bilingual site are all shipped and stable,
and this release makes the two things a 1.0 needs — release notes a player can
read, and enough instrumentation to know whether the newest feature actually
works for people who are not us.

### Added

- **Room funnel telemetry.** The room feature shipped in 0.3.0 with only the host side instrumented, which left the funnel without a denominator: `room_submission_received` counts submissions that *landed*, so a room with one submission was indistinguishable from one scan that worked and eight that bounced. The player side had no events at all — `app/j/[code]/page.tsx` did not import `trackEvent`. Six events close it:
  - `room_join_opened` (`join_page`, `wants_playlist`) — fires on every landing at `/buzz/[code]` and `/j/[code]`, including the ones that go no further. This is the denominator; `buzz_player_joined` only ever counted phones that made it.
  - `room_submission_sent` (`submitted_by`, `track_count`) and `room_submission_failed` (`submitted_by`, `reason`) — the phone's own view of submitting, which the host's poll cannot see: a player who hits an error never reaches the mailbox, so host-side counting reads it as "never scanned". `reason: "too_late"` is the 410 specifically, i.e. arrived after the host built the pool — a design question about when the mailbox closes, not a bug, and worth separating from real errors.
  - `room_open_failed` (`room_jobs`, `reason`) — a room that never opens is the one failure the funnel cannot infer, because the host gives up and every downstream event simply never happens. `reason: "buzzer_unavailable"` is split out because it means the Worker is down for everyone rather than that this host did something wrong.
  - `room_start_failed` (`contributor_count`) — a full room whose pool was refused: every playlist in, still no game.
  - `changelog_opened` (`version`) — reads of the panel below, attributed to the release being read.
- **A "What's new" overlay** in the footer of `/`, `/about` and `/zh`, replacing nothing — there was previously no way for a player to find out what changed. An overlay rather than a `/changelog` route on purpose: release notes are a detour, not a destination, and a navigation would discard the half-configured setup form, whose state lives in React. It would also want indexing, sitemap and `hreflang` entries for content with no search value.
  - Content lives in `lib/changelog.ts`, hand-written and deliberately *not* generated from this file. This one is a maintainer's record and includes a todo list; that one is for someone who came to play a party game.
  - Every entry is bilingual, as parallel `text`/`textZh` fields on one object rather than two lists. `/zh` is written natively rather than translated and its footer says 回報問題, so an English-only panel opening off it would undo the one thing that page is for. Parallel fields make a missing translation a type error instead of a silent English fallback.
  - Renders through a portal into `document.body`. The homepage footer sits inside `.fade-in` containers whose finished animation leaves a non-`none` transform behind, which makes them the containing block for `position: fixed` — an inline overlay was clipped to the footer.
  - Escape, backdrop click, body scroll lock, Tab trapped inside the dialog, focus restored to the trigger on close.

### Changed

- `room_created` and `buzz_room_created` now carry `room_jobs` (`"playlists" | "buzzer" | "both"`), previously `Record<string, never>`. A combined room fires *both* events, and without the param GA4's standard reports cannot tell that pair from two unrelated rooms opened in one session.
- Failure reasons on the new events are bucketed enums, never the raw error message. Messages come from upstream APIs and from pasted user input, so forwarding them verbatim would both blow up parameter cardinality and risk carrying a playlist URL into GA4. A test asserts the bucketing.
- `roomJobs()` moved from a module-private helper in `components/room-panel.tsx` to an export of `lib/analytics.ts`, beside the `RoomJobs` type it returns. It decides `room_jobs` on every room-created and room-open-failed event, so getting it wrong mislabels the whole funnel rather than merely dropping an event — and a private function inside a component is unreachable from a suite that covers `lib/` only. Now has tests for all three branches.
- `.link-btn` gained `cursor: pointer` and an explicit `line-height` in all three page styles, since it is now applied to a `<button>` as well as an `<a>` and buttons inherit neither.

### Known gaps

- Every new parameter needs registering as a GA4 custom dimension (event-scoped) before it appears in anything but Realtime and DebugView, and registration is not retroactive. `track_count` wants to be a custom *metric*, not a dimension.
- `trackEvent` no-ops when `NODE_ENV !== "production"`, so none of this can be verified against `next dev` in GA4 itself — only via the `console.debug` line it falls back to. Confirming the real pipeline means deploying and using DebugView.
- `room_join_opened` fires per page load, not per person. A player whose phone drops Wi-Fi and reloads counts twice, so the scan-to-submit rate is a floor rather than an exact figure.
- The overlay's release list is hand-maintained alongside this file. Nothing enforces that a release updates both; the tests only check ordering, non-emptiness and that both languages are present for whatever is there.

## [0.4.0] - 2026-07-29

### Added

- **Traditional Chinese landing page at `/zh`.** The site only ranked for the brand string "guessong" — a query nobody types unless they already know us. English head terms ("guess the song", "guess song") are a red ocean of Heardle clones, but the Chinese equivalents are not, and the audience is already here: the homepage hero has carried a Chinese line since launch. `/zh` is written natively rather than translated, and its `<h1>` is the keyword itself (`猜歌遊戲`) rather than the brand, because unlike `/` it has no brand identity to protect. Carries its own `HowTo` and `FAQPage` JSON-LD in `zh-TW`, and the homepage's Chinese hero line is now the crawl path into it, so the anchor text is the keyword instead of sitting next to it.
- **`hreflang` annotations** across `/` and `/zh` (`en`, `zh-TW`, `x-default`), emitted both as `<link rel="alternate">` tags and in `sitemap.xml`. Both URLs carry the full annotation set — a one-sided declaration is a weaker signal than none — and the visible language switcher on `/zh` points at `/` to match what the annotation claims.
- **`FAQPage` structured data on the homepage** and **`HowTo` on `/about`**, the latter generated from the existing `STEPS` array so the schema cannot drift from what the page actually renders.

### Changed

- **The homepage now has content for a search engine to read.** It was a setup form and roughly 50 words of prose, which left Google nothing to match "guess the song game" against except the brand string. Added a "What is GuessSong?" section and six FAQs — 588 words, all of it useful to a first-time visitor too, not keyword filler. The hero tagline ("Play a clip. Guess the song. Compete.") became an `<h2>` so the phrase people actually search for is a heading; the `<h1>` stays `GuessSong` and the hero is visually unchanged.
- Titles and descriptions across `/` and `/about` lead with the generic phrase instead of the brand. `/about` is now "How to Play the Guess the Song Game".
- Trimmed `keywords` from 22 entries to 11. Google has ignored the tag since 2009; the list is kept only because Bing still weighs it slightly, and a focused list is worth more there than a long one.
- Added an explicit canonical for the homepage. It's a client component and can't export its own metadata, so it lives in the root layout.

### Fixed

- `/buzz` and `/j` are now disallowed in `robots.txt`. They're ephemeral room codes that 404 once the room's TTL expires, so crawling them spent budget on pages guaranteed to rot.

### Known gaps

- The root layout owns `<html lang="en">` and Next.js only lets the root layout render `<html>`, so `/zh` scopes its language with `lang="zh-Hant-TW"` on its `<main>` instead. `hreflang` is what Google keys off, so ranking is unaffected, but a screen reader that only checks the root element will read the page with an English voice. Fixing it properly means moving every route into a `(lang)` route group with per-locale root layouts.
- Only `/` and `/zh` form an `hreflang` cluster. `/about` has no Chinese counterpart of its own — `/zh` covers that content — so it is deliberately left out rather than pointed at a page that isn't its translation.
- `/zh` duplicates about 200 lines of CSS from `app/about/page.tsx`. That matches the project's per-page `<style>` block convention, but a third page in this style is the point where the shared rules should be extracted.

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
