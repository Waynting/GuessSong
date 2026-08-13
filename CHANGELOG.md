# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-08-13

A host-facing control and a deletion, which are the same change seen twice: the
setup page now asks how many songs and accepts any answer, and it no longer
offers to play for you. The built-in trial playlists went with the cards, and
"trial" mode went with them — it had exactly one entry point.

The deletion is the larger half. `lib/builtin-playlists-data.json` was 48 baked
tracks shipped in the browser bundle for a path that ended in a single-player
scoreboard, and `app/game/page.tsx` carried a parallel render tree for it:
its own scoring control, its own finished overlay, its own top-bar counter, its
own grid. Removing the entry point without the branches would have left ~90
lines that nothing could reach and a `GameMode` member nothing could produce.

### Added

- **`lib/song-count.ts`** — the Number of Songs control's whole state machine,
  in `lib/` rather than the component because that is what the suite can reach.
  `SongCountState` is `{count, field}`: the count is the answer, the field is
  what has been typed. They are separate because a number input passes through
  states that are not yet a count (`""`, `"-"`, `"1"` on the way to `"150"`),
  and the game must not follow the field there.
  - `typeCustom` runs per keystroke and **rejects** out-of-range input rather
    than clamping it, so a half-typed number cannot commit.
  - `commitCustom` runs on blur and **clamps** instead, so 999 answers 500.
    Rejecting on commit is what the first draft did, and it left the field
    showing 99 — the last in-range prefix, a number nobody typed, from a rule
    nothing on screen states. Caught in the browser, not by a test.
  - `MAX_SONG_COUNT` mirrors `MAX_PLAYLIST_TRACKS` by copy, not import:
    `lib/spotify.ts` is server code and importing it into the setup page would
    pull the Spotify client into the browser bundle.
- `tests/song-count.test.ts` — 26 cases over the pure layer, including the
  clamp regression, blur idempotency, and an invariant sweep asserting the
  control can never land on a count the game cannot honour.

### Removed

- **The "Try it now — no playlist needed" section and its three cards**
  (`app/page.tsx`), plus `handleQuickStart`, the `.trial-*` CSS, and
  `lib/builtin-playlists.ts` / `-data.json` / `scripts/fetch-builtin-playlists.mjs`
  / `tests/builtin-playlists.test.ts`.
- **`GameMode`'s `"trial"` and `PlaylistSource`'s `"builtin"`**, and every
  branch behind them in `app/game/page.tsx`: `isTrial`, `markTrialCorrect`, the
  Skip button, the "Correct: N" badge, the trial finished overlay, the
  `.game-layout.trial` grid, and the `!isTrial` guard that was hiding the
  sidebar. `correct_count` leaves `game_finished` for the same reason.
- `roundsPlayedRef` in `app/game/page.tsx` — the trial overlay's "You got X / Y"
  was its only reader outside `trackGameFinished`, so it had become a ref that
  carried a value between two adjacent lines.

### Changed

- `parseGamePayload`'s allow-list fallback is now also the retirement path: a
  game sitting in sessionStorage under `mode: "trial"` when this deploys reads
  back as `party` and keeps playing, rather than failing to parse and dumping
  the host at `/`. `tests/game-session.test.ts` pins that.

### Known gaps

- The Number of Songs control is single-playlist only. Mixed mode still offers
  `MIXED_SAMPLE_COUNTS` (5/8/10/12) per player with no custom field; the same
  `lib/song-count.ts` state machine would fit it, and the server-side
  `sampled_per_player_invalid` code already exists to validate the wire value.
- `app/share/unsupported/page.tsx`'s album copy used to point at the built-in
  playlists as the way out. It now suggests opening a playlist instead, which
  is honest but a weaker landing for someone who arrived by sharing an album.

## [1.4.0] - 2026-08-13

Upstash command volume, audited end to end after 1.3.2's outage traced back to
a spent monthly quota. The audit found that rooms were not the main consumer —
they are one of five, and the two largest were an idle browser tab and a log
line. Reviewing the room path for what it actually spent turned up the lost-write
race that `### Fixed` describes, which is the reason this is a minor and not a
patch. Nothing here changes what the app does; a party plays identically.

Rough per-command accounting before and after, for the paths that dominate:

| Path | Before | After |
|---|---|---|
| Roster poll, 30-min lobby, nobody arriving after minute two | 900 | 240 |
| Cold 25-track preview batch, cooldown reads alone | up to 50 | 2 |
| `recordGameStart` (one hosted game) | 6 | 4, then 3 |
| Playlist/preview miss, log line only | 2 extra each | 0 |
| `consumeRoomPool` | 3–15 | 3 |

### Changed

- **The roster poll backs off when nothing is happening** (`pollIntervalMs` in
  `lib/room-poll.ts`). It was a flat 4s for the life of the room, which is two
  Upstash commands a tick whether or not anyone is still scanning — 450 ticks
  over `ROOM_TTL_SECONDS`, almost all of them re-reading a roster that stopped
  changing in minute two. The ladder is 4s → 8s after a minute of silence → 20s
  after five, and **every arrival resets it**, so a room that is filling polls
  exactly as fast as it did before. Returning to a backgrounded tab still polls
  immediately. The existing three bounds (terminal status, deadline, visibility)
  are unchanged; this bounds the *rate* where those bound the total.
- **The per-source preview cooldown is memoized in module scope**
  (`lib/preview-cache.ts`). It is a site-wide, minute-scale signal that
  `askUpstream` consulted once per source *per track*: a cold 25-song game spent
  up to 50 KV reads learning the same two answers, more commands than the
  batch's own writes. A known-future `until` is now trusted without re-reading;
  "not cooling" is held 5s, far below `MIN_COOLDOWN_SECONDS`, because it is the
  answer that spends upstream calls. Concurrent resolutions share one read
  through an in-flight map — without it a batch smaller than `BATCH_CONCURRENCY`
  never benefited at all. `startCooldown` primes the memo, so a 403 parks the
  source for the rest of the batch with no round trip.
- **The loop liveness marker is written once per instance per UTC day**
  (`lib/loop-stats.ts`). Its reader (`scripts/loop-stats.mjs`) only asks whether
  the count is above zero, so bumping it alongside every metric doubled the cost
  of the whole `loop:stats:` namespace — `recordGameStart` spent six commands,
  three of them on the same key. Recorded as written only after the write
  lands, so a single failed request cannot cost the day its marker.
- **Cache miss logs no longer read counters back to compose themselves**
  (`recordMiss`, `recordOutcomes`). Both spent two extra KV reads per miss —
  on the path that is by definition already the expensive one — printing a
  cumulative `rate=` for a log nobody tails. The lines now describe the request
  they belong to; `getCacheStats()` / `getPreviewCacheStats()` / `npm run stats`
  answer the cumulative question when someone asks it. Documented in
  `docs/operations.md` §4 and `CLAUDE.md`.

### Added

- **The `share` surface finally has a denominator.** Every other loop surface is
  a DOM node, so `components/loop-cta.tsx` and `components/loop-qr.tsx` can
  report an impression when it renders. This one is a QR painted into a canvas
  by `drawCardFooter`, so nothing ever fired: `npm run stats` printed `shown=0`
  against a non-zero `followed`, and a rate of `—` for the one arm that reaches
  people who have never seen a page of ours. `recordCardImpression` in
  `app/game/page.tsx` fires it when a card is actually saved. Only `shared` and
  `downloaded` count — a dismissed sheet and a failed render leave no image, so
  no QR entered the world and an impression would be a denominator for a card
  nobody has. The unit is therefore **a party that produced at least one card**,
  not a card, since the per-tab dedup folds the scores card and the taste card
  into one. `docs/viral-loop.md` §2 and §6 now say so, and its troubleshooting
  table gains the `shown=0 but followed>0` row that names this exact shape.

### Fixed

- **Room writes are atomic.** `lib/room.ts` stored the whole room as one JSON
  value, so two players submitting within the same few seconds — the ordinary
  case for a QR everyone scans at once — both read it, both added themselves,
  and the second write dropped the first. There is no CAS on get/set, so the
  code re-read before writing and read *again* afterwards to detect a clobber,
  retrying up to five times: four commands on the happy path, ten under
  contention, and a narrowed window rather than a closed one. A room is now a
  hash and a contribution is a single `hsetnx` on `p:<folded name>` — one
  command that wins or loses, with nothing to verify and nothing to retry.
  `consumeRoomPool` decides its race the same way, on `consumed`.
- **The roster poll no longer carries the pool.** Track lists moved out of the
  room record into `room:v2:<CODE>:t:<folded name>`, so a poll reads names and
  counts instead of dragging every contributor's full playlist across the wire
  every few seconds to render a dozen chips. `consumeRoomPool` collects them
  with one `mget`, once, at kickoff.
- **`createRoom` cannot hand the same code to two hosts.** The check-then-write
  pair became a single `hsetnx` claim. It also deletes the key if the follow-up
  `expire` fails, rather than leaving a room with no TTL holding a code Buzzer
  Mode may be about to reuse.

### Known gaps

- **Rooms open across this deploy will 404.** The key prefix is versioned
  (`room:v2:`) because the old value is a string and every command here is now a
  hash command — an unversioned key would answer `WRONGTYPE`, not a polite 404.
  Old keys are unreachable and age out within `ROOM_TTL_SECONDS`; a host
  mid-lobby at deploy time sees "room not found" and reopens.
- **`ROOM_MAX_SUBMISSIONS` may be exceeded by one under a dead heat.** The cap
  is checked before the playlist fetch and deliberately not re-enforced after
  the claim: rolling a winner back because a simultaneous submit pushed the
  count over would turn away someone who did arrive in time. Thirteen
  contributors instead of twelve is the worse-case outcome, and it is harmless.
- **A cooldown started by another instance is joined up to 5s late.** Bounded by
  `COOLDOWN_MEMO_MS` and far below the 30s floor a cooldown ever lasts, so a
  cooldown is never missed — only entered slightly after it was declared.
- **A submission landing in the same instant as Start may be pooled and still
  told 410.** Claiming `consumed` is what decides the consume race, so it has to
  happen before a simultaneous submit is knowable; if that submit's `hsetnx` won
  first, its tracks are in the pool while its author sees "the game already
  started". The old code had the mirror of this (told 410, *not* pooled) through
  a wider window. Closing it needs a transaction, which get/set/hash cannot
  give; the visible cost is one confusing message on a millisecond boundary.
- **The `share` impression can only ever be a floor.** Its `followed` may arrive
  weeks later from a device that has never seen the site, so numerator and
  denominator are not the same population and the rate is a spread indicator,
  not a conversion. `docs/viral-loop.md` §6 spells this out.

## [1.3.2] - 2026-08-13

A user reported that a public playlist would not load. It loaded fine from
Spotify — the app returned `500` with an empty body on **every** API route, and
the client, having no `code` to render, fell through to `playlist_load_failed`:
"Couldn't load that playlist." The message pointed at the host's URL, so they
re-copied the link from the web player and the desktop app before reporting it.

The cause was Upstash's monthly request cap (500,000 on the free plan) being
spent, which fails every Redis command until the quota rolls over — days, not
the seconds a blip costs. Investigating what spent it turned up a second bug,
and reviewing that turned up a third.

### Fixed

- **`lib/rate-limit.ts` now fails open on a KV error.** It was the only KV
  consumer in the app that did not — `lib/playlist-cache.ts`,
  `lib/preview-cache.ts` and `lib/loop-stats.ts` all wrap their calls, and
  `app/api/pulse/route.ts` even implements the rule locally with a "fail open"
  comment. `enforceRateLimit` runs at the top of all seven API routes *before*
  each handler's own `try`/`catch` (`/api/preview` has no `try` at all), so a
  throwing `incr` escaped the handler and Next answered with a bare 500 and no
  body. A limiter reads like the one place to fail *closed*, which is why this
  survived review; the trade is documented at the callsite and in `CLAUDE.md`.
  Giving up the per-IP ceiling costs little here — the limits mostly blunt
  guessing against `lib/room.ts`'s 4-char code space, and rooms live in the same
  KV that is already unreachable. Failure logging is throttled to one line a
  minute so an exhausted quota is visible without one line per request.
- **`poolContributions` backfills to the length the host asked for.** A song two
  contributors both added spends a slot from each of their quotas, so the pool
  shrank as overlap rose and nothing on the setup screen said so. Measured over
  3,000 pools of two 40-track playlists at 8 per player: 50% overlap returned
  12.5 tracks instead of 16, identical playlists returned 8, and each player's
  *exclusive* tracks fell faster than the total (8 → 4.5 at 50%). The fair pass
  is unchanged and still runs first; `sampledPerPlayer` is now a starting cap
  that rises one notch at a time until the target is met or the pool runs dry,
  raised uniformly so nobody passes `cap` until everyone has reached it. Pool
  size is now exactly `contributors x sampledPerPlayer` at every overlap level,
  bounded by the number of distinct songs — a full-length game that repeats a
  song is worse than an honest short one.
- **The room roster poll can now stop.** `components/room-panel.tsx` ran a bare
  `setInterval` bounded only by the panel staying mounted, at two Upstash
  commands a tick every 4s. A host who opened a room and left the tab parked
  polled at ~15 requests a minute indefinitely, against rooms `ROOM_TTL_SECONDS`
  had already deleted — the 404s were swallowed and retried. That is ~43k
  commands a day per abandoned tab on a 500k-a-month plan. Three bounds now:
  a terminal status (404 gone, 410 already started), a deadline of
  `ROOM_TTL_SECONDS` from mount, and a hidden tab (skips the fetch, polls once
  on return). `setTimeout` replaces `setInterval` so a slow poll cannot stack
  ticks behind it.

### Changed

- **New `lib/room-poll.ts`.** The three bounds above were written inside the
  component, where nothing could test them — `vitest.config.ts` collects only
  `tests/**/*.test.ts` and there is no React testing stack, which is what
  `lib/analytics.ts` means by keeping its param helpers out of the calling
  component. `pollTickAction` and `canPollAgainAfter` are pure and now carry the
  policy; the component keeps only the scheduling. The deadline is checked
  *before* the fetch, so the last tick of a room's life no longer spends a
  request learning what the deadline already knew.

### Known gaps

- The Upstash quota is still spent at the time of this release. The site works,
  but rooms and Mixed Playlist Mode are down until it rolls over, every cache
  misses, and the global Spotify/preview budgets — themselves KV counters that
  fail open — are not enforcing. See `docs/operations.md` §5.
- The scheduling left in `components/room-panel.tsx` (timer wiring, listener
  cleanup) is still untested; only the policy moved to `lib/`.

## [1.3.1] - 2026-08-10

Vercel's Fluid Compute bills Active CPU, and this project was at 79.9% of the
Hobby month's 4 hours. Two things were spending it, and neither was the work the
app exists to do. A two-minute sample of production logs put **42 of 54 billed
invocations (78%) on `POST /api/playlist` returning 404** — one host, one dead
link, tapped over and over. The other 10 were image routes that were supposed to
be built once and were being rendered per request instead.

Neither is visible on the page: the images come out byte-identical, and the
retry loop looked like a working error message. Both are the kind of cost that
only shows up on the bill.

### Fixed

- **The three generated-image routes no longer run per request.** `app/icon.tsx`,
  `app/opengraph-image.tsx` and `app/icons/[size]/route.tsx` each carried
  `export const runtime = "edge"`, which opts a route out of static generation —
  Next says so in a build warning that is easy to read past, and the route table
  showed them as `ƒ` while the logs showed `edge-function` / `cache: MISS`. They
  were satori rasterisations, the most CPU-expensive thing here, and the OG image
  is fetched once per share. Deleting three lines makes them `○`/`●`; the
  prerendered bytes are identical to what production was serving (685 / 125706 /
  3460 / 10094 / 5583). `app/icons/[size]` also gains `generateStaticParams` and
  `dynamicParams = false`, so the three sizes prerender and any other segment
  404s without an invocation at all.
- **A refused playlist is no longer re-requested.** A 404 comes back from
  `lib/playlist-cache.ts`'s negative cache in about 100ms — faster than the Start
  button re-enables — so a host mashing Start produced bursts of fourteen
  identical requests 150–300ms apart, each a billed invocation replaying a
  decision already made. `isDeterministicPlaylistFailure` (`lib/error-messages.ts`)
  names the codes where resubmitting the same URL provably cannot answer
  differently; `app/page.tsx` re-shows the error instead of sending. Measured:
  6 taps → 1 request, and editing the link rearms it.
- **Mixed Playlist Mode gets the same guard, keyed on the whole roster**
  (`mixedRosterKey`, `lib/mixed-playlist.ts`), where a mash cost one request per
  contributor. Measured: 6 taps on a two-contributor roster → 2 requests, and
  swapping a contributor rearms it. `mixed_playlists_failed` is an aggregate and
  is *not* treated as final on its own — `shouldRememberAllRejections` requires
  every individual rejection to be deterministic, so one contributor's transient
  500 cannot write off the whole party.

### Changed

- `/icons/<anything-else>` now returns Next's 404 page rather than a plain-text
  "Not found" body. Same status, no invocation, and nothing reads that body —
  `public/manifest.json` only ever requests the three real sizes.

### Known gaps

- Throttling codes are deliberately excluded from the deterministic set, so a
  host throttled by Spotify's shared quota can still retry. `tests/error-messages.test.ts`
  pins that in both directions, including a complement test that defaults any
  newly added `AppErrorCode` to retryable.
- `app/j/[code]` and `app/buzz/[code]` are still `ƒ` — pure client components
  paying an SSR invocation per QR scan. They did not appear once in the sampled
  logs, and making them static risks rendering the wrong room code before
  hydration, so they were left alone.
- The 78% figure is one two-minute sample, not a 30-day average.

## [1.3.0] - 2026-08-09

Buzzer Mode has been putting a phone in every hand for weeks, and none of those
phones were ever told what they were holding. `app/buzz/[code]/page.tsx` was 264
lines containing zero `<a>` tags and not one occurrence of the string
"GuessSong"; `app/j/[code]/page.tsx` ended at a confirmation card with nowhere
to go; `lib/result-image.ts` printed "Played with GuessSong" on the one artifact
that leaves the party, with no address on it. The expensive half of a viral loop
— rooms, live sockets, share cards — already shipped. This release is the cheap
half nobody had written.

### Added

- **A way back to the product from every player-facing surface.** Five of them,
  each named once in `lib/loop-links.ts` and derived from there everywhere else.
  The name is needed in three places at once — the link's `href`, the analytics
  param, and the server-side validator — and hand-syncing them fails *silently*:
  a renamed href against a stale validator still redirects, the counter just
  stops incrementing, and that arm reads as "nobody clicked it". You would then
  correctly conclude the CTA was useless and delete one that was working. Same
  single-union trick `lib/buzzer-protocol.ts` uses across the Worker boundary.
  - `buzz_footer` on all three of the buzzer page's return paths, including the
    pre-join form — the calmest screen on that phone, and the only moment there
    that is not competing with a song.
  - `buzz_cta`, a full-width button on the live buzzer screen, shown only
    between rounds and never before the first has resolved. Gated on
    `snapshot.roundIndex >= 1 && phase === "idle"`, **not** on a `locked → idle`
    transition: `handleResolve` in `worker/src/buzzer-room.ts` reaches `idle`
    from both `open` and `locked`, so a round nobody buzzed at is
    indistinguishable from one that was answered. `roundIndex` advances only on
    `host:next`, which is exactly "a round finished", and reading it off the
    snapshot means it survives a reconnect where the snapshot is adopted whole.
    Rendered always and hidden when inactive, so appearing between rounds cannot
    shove the buzz button down the screen under someone's thumb.
  - `join_submitted` on the Mixed Playlist confirmation screen, which was a dead
    end and is the one moment on that page where the player has finished the
    task and is still looking.
  - `game_over`, a QR on the host's Game Over screen. The highest-attention
    surface the product has and the only one it never used: the music has
    stopped, every person in the room is looking at a television, and they all
    still have the phone they spent the last half hour buzzing with. The trial
    overlay has shipped "Start a Party Game →" since launch; the party path, the
    one with five other people in it, had nothing.
  - `share`, a QR drawn into the result card itself.
- **`POST /api/pulse`**, for the two facts the browser knows and no existing
  request carries: that a loop surface was rendered, and that a hosted game
  started with the device's game index. Sent with `navigator.sendBeacon`,
  because both fire immediately before a navigation and an in-flight `fetch` is
  cancelled as the document tears down — the measurement would be lost exactly
  in the cases worth measuring, and lost silently. Body validated field by field
  in `lib/pulse.ts`: it is unauthenticated by necessity (the people it measures
  have no accounts), so the body is as trustworthy as a query string, and one of
  its values becomes part of a KV key.
- **`host_game_index`**, a per-device count of hosted games in `localStorage`
  (`lib/host-session.ts`). `>= 2` is the number this whole line of work is
  waiting on — proof that someone came back — and it is deliberately reported as
  a **floor**: iOS evicts script-writable storage after seven days without a
  visit, which is precisely the gap between two parties, private windows start
  empty, and a laptop passed around a room is several hosts wearing one
  identity. Raw integer in GA4, not a bucket: CLAUDE.md's bucketing rule is
  about *failure* params, where the value comes from an upstream string; every
  count param already there (`round_index`, `player_count`, `rounds_played`) is
  raw, and bucketing at collection freezes the boundaries before the
  distribution is known.
- **`arrived_from` on `game_started`**, credited to the last loop touch within
  60 days rather than to the visit that carried the `?ref=`. The conversion is
  not same-session — somebody taps a CTA on a friend's sofa and hosts their own
  party a fortnight later — so attributing only within the pageview would record
  almost every real conversion as organic and report a working loop as dead.
- **Server-side counters** in `lib/loop-stats.ts`, held 30 days rather than the
  7 `lib/playlist-cache.ts` uses. A weekly digest whose window ends a couple of
  days back would expire the oldest day of every report right before reading it,
  and an expired key is indistinguishable from one never written. Also carries a
  **liveness marker**, bumped unconditionally alongside every other counter,
  because `mget` returns null for a key that was never created and that is what
  a genuine zero looks like too — without it, "the CTA does nothing", the single
  most important negative result available here, would render as "no data yet"
  forever.
- **`npm run stats`** (`scripts/loop-stats.mjs`), which prints the counters as a
  table: shown/followed/rate per surface, games started, repeat hosts, the
  distribution by host game number, and how many clicks the limiter dropped.
  Keys are **discovered** (`KEYS loop:stats:*`) rather than rebuilt from a
  hardcoded list, so this file holds no second copy of the metric names — that
  drift would be silent, printing a confident table of zeros for keys nobody
  writes, and discovery also means a metric added later appears here on its own.
  The output leads with the caveats, because every number in it is a floor and
  the failure mode is reading a low one as "the CTA does not work" rather than
  as "we could not see that it did".
- **`dayBucket()` in `lib/kv.ts`**, replacing the copies that had accumulated in
  `lib/playlist-cache.ts` and `lib/preview-cache.ts`. The writer and the reader
  of a day-bucketed counter always live in different modules, so the exact
  string is the contract between them; a divergence throws nothing and simply
  addresses a different key. UTC, so a lambda and a laptop agree. Pinned by a
  test asserting the literal.

### Changed

- **The loop link is a real navigation to `/r/[surface]`, not a click handler.**
  The click being measured is the click that leaves the page, so a background
  report fired at that moment is the report most likely to be cancelled. Routing
  through the server makes the navigation itself the measurement — there is
  nothing left to cancel. Plain `<a>` rather than `next/link`, because
  prefetching a counting endpoint would inflate it with hits nobody made, and
  `/r` is disallowed in `app/robots.ts` for the same reason.
  - **The visitor always reaches the setup page.** Unknown segment, spent rate
    limit, KV unavailable: every branch still redirects, and only the count is
    allowed to be lost. The person clicking is precisely the person the feature
    exists to reach; refusing them to protect an integer would be an own goal.
    Same fail-open contract as `lib/playlist-cache.ts`'s global budget.
  - The limiter is sized for a household rather than a person (120/hour), since
    it is keyed by IP and a party is a dozen phones behind one Wi-Fi address —
    `app/api/room/[code]/status` is the standing lesson on what a per-device
    budget does to a whole room. Throttled clicks are counted separately so the
    undercount appears in the digest instead of quietly depressing the rate.
  - `Cache-Control: no-store`, or an intermediary caches the 302 and every later
    click from that network is served without reaching the counter: the redirect
    would keep working while the measurement silently stopped.
- **The result card footer is a QR, not a line of text.** It used to read
  "Played with GuessSong" — a brand with no address — so anyone who saw it in a
  group chat had to already know the name, which is the audience it does not
  need to reach. Printing the URL as text is barely better; nobody retypes a URL
  off a screenshot. `drawCardFooter` is now async and takes the code, and
  `CARD_FOOTER_HEIGHT` is exported so the two callers that size the canvas
  cannot drift from what the footer draws.
  - **The URL is deliberately not also added to the `navigator.share` payload.**
    iOS drops `url` when a file is attached, and several Android targets drop
    the *file* when a `url` is present. Risking the image, which is the entire
    payload, to add a link one platform throws away is a bad trade.
- `?ref=` is read from `window.location.search` in an effect, **not**
  `useSearchParams`. `app/page.tsx` is a client component that is still
  statically prerendered, carries the FAQ structured data, and takes
  essentially all of the site's traffic; an unsuspended `useSearchParams` either
  fails the Next 15 build or opts the page out of prerendering, and there is no
  Suspense boundary anywhere in this app. Verified against `next build`: `/`
  remains `○ (Static)`.
- `?ref=` is validated through `isLoopSurface` before it can reach a GA4 param.
  `/?ref=` is a public URL, and CLAUDE.md's analytics rule against user input in
  params is the same hazard by a shorter path. Anything unrecognised is
  `organic`.
- Impressions are counted once per surface per tab. `room_join_opened` fires per
  page load — a phone that drops Wi-Fi and reloads counts twice, as this file
  already noted in 1.0.0 — which makes it a floor rather than a denominator.

### Known gaps

- **`arrived_from: "organic"` is a catch-all.** Every lost attribution lands
  there: a PWA launched from the home screen, a stripped query string, a URL
  retyped without its path. Since organic is already effectively all of the
  traffic, the loop's share of starts is a floor and a low number cannot be read
  as "the CTA does not work" without ruling out "we could not see it".
- **The `share` arm is the weakest link and stays that way.** It now depends on
  someone scanning a QR out of a forwarded image rather than typing an address,
  which is a large improvement over nothing but still the only surface whose hit
  does not originate on a page of ours.
- **`npm run stats` is the only reader, and it is a manual command.** A
  scheduled push was designed and then dropped on the maintainer's call, which
  was the right call: a webhook adds a deploy surface, three environment
  variables and another feed to read, and the variable that actually predicts
  whether a number gets looked at is not push-versus-pull but whether reading
  it requires leaving the editor. What makes the command work is the line in
  CLAUDE.md telling an agent to run it — delivery moved from a human habit with
  a 0/4 record to something that happens at the start of a session. If that
  line gets deleted, this reverts to the same defect every release before it
  had.
- `host_game_index` is capped at 10 in KV to bound the key space. Fine for the
  question being asked; it would need revisiting before anyone studies the tail.
- The buzzer wire protocol still has no end-of-game signal (`BuzzerPhase` is
  `idle | open | locked`, `ClientMessage` has no `host:end`), so the player's
  phone cannot react to the game finishing. `buzz_cta` uses "a round has
  resolved" as the nearest available proxy. If its conversion comes in clearly
  below `join_submitted`, that gap is the signal that the protocol change is
  worth making.
- Route handlers still have no unit tests anywhere in this repo. The two added
  here are shells over `lib/loop-redirect.ts` and `lib/pulse.ts`, which are
  tested, but the 302 status, the `Location` header and the `Cache-Control` are
  verified only by reading them.

## [1.2.0] - 2026-08-09

### Fixed

- **A cover, a nursery rhyme, or an unrelated song sharing the title could be played instead of the track on the answer card — and cached as correct for a year.** `pickItunes` took `(results, track)`: the artist was never passed in, let alone checked. Its "exact match" compared `trackName` only, and its fallback was `results.find(r => r.previewUrl)` — literally the first playable result. That fallback is reached constantly, because `askUpstream`'s second iTunes query is the bare title with the artist deliberately stripped, so upstream ranks by popularity alone. Measured against the live API: `Hello` returns Pinkfong's nursery rhyme rather than Adele's, `Alone` returns Heart's 1987 single rather than Marshmello's, `小幸運` returns a cover. The pick was then written to KV as `found` and held for `FOUND_TTL_SECONDS` — a year — and never revisited, since `&refresh=1` repairs rotted URLs, not wrong songs. For a guessing game this is worse than reporting no audio: the clip plays, and then the answer card contradicts it.
  - **`pickCandidate` (replacing `pickItunes`) decides on three signals arranged as a tier list**, because none of them survives every case. Credits are routinely translated — iTunes returns 盧廣仲 as "Crowd Lu" and 田馥甄 as "Hebe Tien" — while a cover shares the original's title by definition, so on a CJK track the only string that lines up frequently belongs to the wrong recording. Running time is translated by nobody: measured against live data the true match agrees with Spotify to within 0–6ms, which is exactly what a re-recording does not do.
    - **The title's two directions are not symmetric**, which is why this is a tier list and not a weighted score. A title *match* is strong evidence (few unrelated recordings share one); a title *miss* is weak evidence (it usually just means "translated"). So the ranking flips on whether the credit is verified: with the artist confirmed a title miss means "different song by the same artist" and the title outranks the clock; with the artist unverifiable a title match means "someone else's cover" and the clock outranks the title. Four tiers, in order: artist+title, artist, duration, then (only when not `requireVerified`) title, then upstream's own first pick. Ties inside a tier go to the closest running time, then to upstream's ranking — which is why a finer "…and the duration agrees" tier above each of the first two would be unreachable code rather than a stricter rule.
    - An earlier cut of this ranked duration above an artist+title match unconditionally, which **regressed 1.1.0**: a remaster sits further off Spotify's clock than a sibling album track does, so asking for `Karma Police` (3s off, exact title) against `Lucky` (500ms off, same artist) played `Lucky`. Caught by the ship coverage audit, pinned by `keeps an exact title outside the window over a sibling track inside it`.
  - **`requireVerified` gates the title-only queries, and only those.** Applying the same check to the queries that already carried the artist upstream looks like an obvious tightening and is a catalogue-wide outage for CJK, where no string matches at all — those rely on upstream's own ranking, which was given the artist. A rejected result is `empty`, not `absent`, so the next source gets its turn and nothing is recorded as a fact about the recording.
  - **`artistMatches` compares on whole-token boundaries**, so "Marshmello" matches iTunes' "Marshmello & Noah Cyrus" but "Sia" does not match "Sian Evans". CJK has no spaces to anchor on and falls back to a plain substring.
  - **`durationMs` is threaded from `Track` through `PreviewBatchTrack`, both preview routes and `PreviewQuery`.** Optional the whole way: an older client, or a track whose length is unknown, matches on names alone exactly as before. It is *not* part of the cache key, so nothing cold-starts. `DURATION_TOLERANCE_MS` is 2s — far wider than the real agreement, to absorb Deezer reporting whole seconds — and therefore wide enough to admit a different song by the same artist (小幸運 and Hebe Tien's Forever Love are 768ms apart), which is why candidates are sorted by drift and the closest wins rather than the first inside the window.
  - **Deezer is picked the same way.** `queryDeezer` previously did `data.find(r => r.preview)` with no title or artist check at all; it now maps onto the same `Candidate` shape (`duration` × 1000) and goes through `pickCandidate`.

- **Every upstream call is bounded by `UPSTREAM_TIMEOUT_MS` (2.5s).** `getPreviews` gates only the *start* of each resolution against its deadline and `fetch` carried no signal, so one stalled socket could take the whole function past the platform limit — and a batch that dies returns nothing at all, dropping every track onto the lazy path. More likely since `requireVerified` makes the iTunes-to-Deezer handover more common.

### Changed

- **iTunes is asked once, not twice, when a track has no artist.** `askUpstream`'s query list was `[\`${track} ${artist}\`.trim(), track]`, and with an empty artist those two strings are byte-identical — every such lookup spent a second upstream call re-asking a question it had just had answered. The title-only follow-up is now appended only when there is an artist to verify the answer against, which is the same condition that makes it safe.

### Removed

- **`Track.previewUrl`, and the three places that read it.** Spotify deprecated `preview_url` in Nov 2024; measured against this app's Client Credentials it is `null` for **0/20** tracks across four markets (none, US, TW, JP). So `convertSpotifyTrack` was writing a permanently-null field into every payload — sessionStorage, the KV playlist cache, `/api/playlist` responses, and 48 baked entries in `lib/builtin-playlists-data.json` — while `app/game/page.tsx` carried two branches that could never be taken: a `.filter(t => !t.previewUrl)` that never filtered anything and a `track.previewUrl ?? cached` whose left side was always null. Removed together with `preview_url` on the `SpotifyTrack` interface. The dead branch was also actively misleading: it reads as though Spotify still supplies the audio, when in fact every clip the app plays comes from iTunes or Deezer.

### Known gaps

- **This fix reaches only tracks nobody has played yet, and that is the largest gap in the release.** `recordToResult` returns `found` for any record holding a URL, positive entries are held a year, the cache key is deliberately unversioned, and `&refresh=1` re-confirms the stored `itunesTrackId` rather than re-picking — so every wrong clip the 1.1.0 picker wrote keeps being served for up to a year. Production was logging `hits=536 misses=505` when this shipped: about half of all preview questions are answered from exactly those entries.
  - A picker-generation stamp on `PreviewRecord` was built during this release's ship review and **backed out**, because an adversarial pass reproduced three ways it made things worse than the stale pick it repaired. Recorded here as the spec for doing it properly:
    1. **A re-pick must not take `resolveAndStore`'s `lookup?id=` shortcut.** Wiring it to `options.refresh` alone means the first `<audio>` error on a pre-1.2.0 track re-confirms the very recording under suspicion and stamps it current — permanently laundering the bug, in the one code path most likely to hit the oldest entries.
    2. **Re-picks need their own admission budget, separate from cold misses.** Superseding the whole positive corpus at once turns a fully-cached 25-track game from 0 upstream calls into 25 budget slots and up to 125 calls. Against `PREVIEW_MAX_LOOKUPS_PER_MINUTE`'s 120 that is under five warm games a minute, site-wide, on deploy day.
    3. **It has to converge under throttling.** Keeping the old URL without stamping it means the next request retries, forever — and the retries are what sustain the throttling.
  - Related and unfixed: a caller with no `durationMs` (an old bundle mid-rollout) writes its weaker name-only pick under the same shared key with the same year-long TTL.

- **A result rejected on verification is cached as `absent`, for a week.** When every candidate fails both checks, `pickCandidate` returns `empty`, which becomes `absent` with `ABSENT_TTL_SECONDS`. But `absent` is documented in this module as a fact about the *recording* — "nothing anywhere has a clip" — and here a clip demonstrably exists; we declined it. That is a new class of week-long false `absent`, and it is invisible in exactly the way the 1.1.0 bug was. Kept deliberately for now: mapping it to `unavailable`'s 90s would re-query, forever and every 90 seconds, every track whose only upstream match is a cover — which is the upstream drain this module exists to prevent. The honest fix is a fourth outcome (`rejected`, cached for hours rather than a week), not a TTL swap.
- `DURATION_TOLERANCE_MS = 2000` is sized for Deezer's whole-second granularity, not for how close the real matches are (0–6ms). A cover mastered to within two seconds of the original still wins if it also outranks the original *and* the credit cannot be verified — rare, and now needs both failures at once rather than either.
- `scripts/fetch-builtin-playlists.mjs` vets bundled tracks with its own stricter artist gate rather than the runtime's `pickCandidate`, and has no Spotify duration on that path to compare against. Comments now say so; the divergence itself is unaddressed.
- **`artistMatches` admits a superset credit, which is the tribute-band naming convention.** Whole-token containment makes `artistMatches("Queen Tribute Band", "Queen")` true, and it is the title-only queries — ranked by popularity, where tribute recordings surface — that rely on the check. Duration does not save it: the clock is only ever a tie-break inside a tier, never a veto, so a single candidate with a wildly wrong running time is accepted unopposed. Closing this wants a credit-separator boundary (`&`, `feat`, `,`, `with`) plus a gross-drift veto.
- **Every admission layer fails open on the same dependency.** `readRecords`, `claimLookupBudget` and `isCoolingDown` each degrade to "allow" on a KV error — individually correct, collectively meaning an Upstash outage removes the cache, the global budget and both cooldowns at the same instant, leaving only per-IP limits against a full five-call fan-out per request. A module-scope fallback counter would blunt it.
- Tracks reaching `/api/preview` without a `durationMs` — an older cached client, or any caller that doesn't pass it — fall back to name matching alone, i.e. to the 1.1.0 behaviour minus the title-only hole.
- `artistMatches` cannot see through translation and is not meant to; the duration signal is what covers that case. A track that is *both* credited under a translated name and has no known duration gets neither signal, and falls through to upstream's ranking.
- The daily counters still record a `&refresh=1` as a miss, so the logged hit rate understates the cache — a refresh is the cheapest upstream path there is (one `lookup?id=`) and is only possible *because* the cache stored the id. Splitting it into its own counter would make `rate=` mean "cold lookups" and give URL rot its own number.

## [1.1.0] - 2026-08-03

### Fixed

- **A throttled preview lookup was cached as "this song has no audio" for a week.** `resolveFromUpstream` in `app/api/preview/route.ts` mapped every failure onto `previewUrl: null` — a 403 from a throttled iTunes, a dropped connection, a 500, all of them — and `writeCache` then stored that for `MISS_TTL_SECONDS`. So one throttled minute at peak marked a slice of the catalogue silent for seven days, on a path where every visitor shares the deploy's egress IP. It never reproduced locally, because a laptop's own IP is never the one being throttled, and it presented as a catalogue gap rather than as throttling — the exact misreading the file's own header comment warned about, reintroduced by the cache write below it.
  - **`lib/preview-cache.ts` (new)** — the resolution and caching logic, extracted from the route so `POST /api/preview/batch` shares it, with three outcomes instead of two. `found` is cached a year, `absent` (upstream answered and has nothing) a week, `unavailable` (we could not ask) **90 seconds**. Only a clean, complete reply may produce `absent`; a source that was skipped, refused us, or failed mid-question makes the whole lookup `unavailable`. The asymmetry is the point: a wrong `absent` lasts a week and is invisible, a wrong `unavailable` costs one retry.
  - **iTunes signals throttling with `403`, not 429**, and **Deezer reports a spent quota in the body of a `200`** (`{error:{code:4}}`). Checking only 429, or only the status, is how the refusal got classified as an empty result set to begin with. A non-OK status of any kind is now `unavailable` too: nothing upstream can say with a 5xx is evidence about a recording.
  - **The client half has the same rule.** `lib/preview-client.ts` (new) resolves every network failure to `unavailable`, never `absent`, and the game page's `previewCache` ref now stores *settled* answers only — it used to write whatever came back, so a failed fetch mid-party left that track silent for the rest of the game.
  - **The cache key is deliberately not versioned.** The stored record is a strict superset of the old `{previewUrl}` shape, so live entries keep reading as hits; bumping a version the way `lib/playlist-cache.ts` does would cold-start every entry in production at once, which is the upstream burst this module exists to prevent. Legacy nulls are read as `absent` for the same reason — some are poisoned by this bug, but re-resolving all of them at once is the stampede that poisoned them, and they age out within the week.

- **`429 QUOTA_EXCEEDED` from Spotify on `/api/playlist`.** Nothing anywhere cached a playlist: `getPlaylistWithTracks` went to the network on every single call, so the same URL re-paginated in full on every host retry, every room submit, and for every player in a room who pasted the same link. Meanwhile Spotify's quota is per *client id* — one budget shared by the whole user base — while every limiter in `lib/rate-limit.ts` is keyed by IP, so N phones each got a fresh allowance against it. Five compounding causes, fixed together:
  - **`lib/playlist-cache.ts` (new)** — KV cache keyed by playlist id, 6h on a hit. A repeat load now costs zero upstream calls. Reads and writes are wrapped so a KV outage degrades to "slower", never "broken", the same contract `app/api/preview/route.ts` follows. This is not a reversal of the token cache's deliberate no-KV decision (`lib/spotify.ts`): a token has no fallback, a playlist does.
  - **In-flight coalescing** in the same module. One Mixed-mode Start fires a request per contributor and a QR room gets a burst of simultaneous submits; duplicate URLs in either used to mean duplicate pagination, because the cache write lands too late to help its own siblings.
  - **A 429 cooldown**, in KV so every lambda instance sees it. Without it a throttled window is self-sustaining — every host sees an error, every host retries, the retries keep the quota pinned. One 429 now parks all *uncached* loads for the duration Spotify asked for (clamped to 30s–15min); cached playlists keep serving, so a party already mid-game is unaffected by someone else's throttling.
  - **A proactive global budget** (`SPOTIFY_MAX_LOADS_PER_MINUTE`, default 40), a KV `incr` counter shared across instances. The cooldown above is reactive — it only helps once Spotify has already refused something. This is the half that stops us getting there: a spike, a scripted client, or a dozen rooms starting at once is refused here rather than spending the quota to find out. Counted in *loads*, not requests; one cold load is 1 metadata call plus up to 5 track pages, so the default works out to roughly 240 upstream requests a minute. Fails **open** on a KV error — losing the safety net has to mean "back to how it was", not "nobody can play".
  - **`limit=50` → `limit=100`** in `fetchPlaylistTracks`, Spotify's documented maximum. Every playlist was costing exactly twice the requests it needed to.
  - **`MAX_PLAYLIST_TRACKS = 500`**, replacing an unbounded `while (data.next)` loop. A 4,000-track playlist was 40 upstream requests for a game that then plays at most 50 of them.

### Added

- **Admission control in front of iTunes and Deezer**, mirroring what `lib/playlist-cache.ts` already does for Spotify, because previews are the hotter path: Spotify is called once per *playlist*, these are called once per *track*, so a cold 50-song game is 50 lookups of up to 5 upstream calls each. Nothing bounded that before — `enforceRateLimit` is per-IP, and every visitor got a fresh allowance against the one egress IP they all share.
  - **A global lookup budget** (`PREVIEW_MAX_LOOKUPS_PER_MINUTE`, default 120), a KV `incr` counter shared across instances. Counted in lookups, not requests: a found track costs one upstream call, one with no preview anywhere costs five. Apple documents roughly 20 calls a minute and in practice allows a good deal more, so the default sits between the two. Fails **open** on a KV error — losing the safety net has to mean "back to how it was", not "nobody hears any music". A refused lookup is *not* cached: the claim is already one cheap atomic op and self-limiting, where a marker per track would spend a KV write during the exact spike being ridden out.
  - **A per-source cooldown**, in KV so every instance sees it, started only when a source *explicitly* refuses us (403/429, or Deezer's quota body). While iTunes is parked the lookup goes straight to Deezer and vice versa, so the saving is the call never made. A dropped connection is `unavailable` but does **not** park the source — one flaky socket is not a rate limit, and parking the better source over it would turn a blip into a site-wide outage.
  - **Daily hit/miss/unavailable counters**, logged on misses only (`[preview-cache] miss hits=… misses=… unavailable=… rate=…`) and readable via `getPreviewCacheStats()`. `unavailable` rising while `misses` stays flat is throttling — the number that used to be silently recorded as a catalogue gap instead.

- **`POST /api/preview/batch`** — resolves a whole game's previews in one request, prefetched by the game page on mount. The reason is the KV bill as much as the upstream one: reading 50 tracks one key at a time is 50 Upstash commands and 50 round trips, where the new `KvStore.mget` is one of each. It also moves the lookup *off* the critical path of every round — resolving lazily meant a throttled minute reached the host as a dead Play button mid-party, the one moment there is nothing to be done about it. Strictly an optimisation: anything the batch defers or is refused comes back `unavailable`, and the per-track `GET` picks it up exactly as before.
  - Bounded three ways, so one cold 50-song start cannot starve every other party on the site: at most 25 tracks resolved upstream per batch, a 6s wall-clock deadline (a serverless function that hits its hard limit returns *nothing*, which is strictly worse than returning what it had), and the same global budget, claimed all-or-nothing so a game defers cleanly rather than stopping halfway through its own playlist. Deferred tracks are not written to KV — nothing refused them, and a marker would suppress the lazy lookup meant to pick them up.
  - `KvStore` gains `mget` and an optional `by` count on `incr`. The second exists so the batch's own stats and budget claims don't spend one command per track and undo the saving the first just made.

- **`&refresh=1` on `GET /api/preview`**, and the `<audio>` `error` handler that fires it. Preview clips sit on a CDN that rotates its URLs, so a cached hit can go dead long before it expires — which is the trade the year-long positive TTL makes, and this is the other half of it. The stored `itunesTrackId` makes the repair one `lookup?id=` call instead of the five-call search fan-out, falling back to a full search if the id has been retired. Once per track per game (a URL that fails twice is not a rotated one), and on its own much tighter rate-limit bucket, since bypassing the cache is the one parameter here that can be turned into an upstream amplifier.

- **Bilingual error messages, everywhere a player can be shown one.** Until now every failure was an English sentence built at the point it was thrown — except the Spotify 404, which was hardcoded *Traditional Chinese* and shown to everyone, so the two languages were already mixed and both were wrong for half the audience. `lib/error-messages.ts` (new) is now the only place an error string exists: one `AppErrorCode` union, one `Record<AppErrorCode, {en, zh}>` table, so a missing translation is a compile error rather than a silent English fallback — the same trick `lib/changelog.ts` uses.
  - **The server sends a code, never a sentence.** A room is read by several devices at once and nothing in a request says what language the *reader* wants: `/api/playlist` is called on behalf of other people's phones in Mixed mode, and `lib/playlist-cache.ts` caches 404s for ten minutes, so localising server-side would freeze whichever language wrote the entry into everyone else's screen. Each client renders the code itself. The English string still rides along in `error` for logs and for any client older than the code it was sent.
  - **The reader's device picks the language** (`detectErrorLocale`, `useErrorLocale`). `/zh` is a landing page with no error surfaces, while every screen that *can* fail is reached by scanning someone else's QR — a Taiwanese guest joining an English host's room still has to be able to read why their playlist was refused. Detected in an effect, not during render, so the server-rendered join pages don't hydrate against a different string.
  - `tests/error-messages.test.ts` enforces what a type cannot: both languages present and different, the same `{placeholders}` in both, placeholders only on the codes whose callers actually pass params, every `BuzzerErrorCode` mapped to a code that exists, and — in both languages — that none of the throttling messages tells the host to check their playlist is public.
- **Random sampling for oversized playlists.** A playlist longer than `MAX_PLAYLIST_TRACKS` is no longer read front-to-back: the first page reports the real length, and the rest of the page budget goes on randomly chosen pages spread across the whole playlist. Taking the first 500 of a 4,000-track playlist would mean the same songs every single game, and whatever the owner happened to add first. Sampling is by *page* rather than by track, because a page is what a request buys and sampling finer would cost more requests — the one thing this whole change exists to avoid. Page 0 is always among the candidates, since reading it is how the length is discovered, so the first 100 tracks are slightly over-represented; everything after them is uniform. Playlists that fit are still read whole and in order.
  - Sampled entries cache for 1h rather than 6h. The TTL is also how long everyone is stuck with the same draw, and six hours of it would undo the point of sampling.
  - `shuffle()` is Fisher-Yates. `Array#sort` with a random comparator, which the setup page still uses for its own shuffle, is not a uniform permutation.
- **Cache hit-rate instrumentation.** Hit/miss counters in KV, bucketed by day, held a week, readable via `getCacheStats()`. The running rate is logged on every *miss* rather than every load: once the cache is working, misses are the rare case, so the instrumentation gets quieter exactly as things get healthier and a sudden run of lines is itself the signal. Previously "did this work" could only be answered by the absence of 429s, which is indistinguishable from a quiet evening.
  - The line names its own caller (`source=playlist-api` / `source=room-submit`, threaded through `loadPlaylist`). Vercel attributes a log line to whichever request its instance happened to be serving, so a miss from `POST /api/room/[code]/submit` can surface against a concurrent `GET .../pool` — a route that never touches this file. Reading the method off the log row then points at a code path that cannot produce the line. `source=unknown` is the default, so a future caller that forgets says so in the logs instead of loading anonymously.
  - Replayed 404s are counted separately (`negative=`) as well as inside `hits`. They are real hits — answered without touching Spotify, which is all the rate claims to measure — but they are the one kind a *broken* input produces on repeat, so a host retrying a playlist they made private used to push the rate up. `hits - negativeHits` is the number that describes real playlists.

### Changed

- `/api/preview` answers `{previewUrl, status}` rather than `{previewUrl}` alone. `previewUrl` is unchanged so an older client keeps working; it just cannot tell "there is no clip" from "we couldn't reach anyone", which is the whole distinction. `preview_miss` in `lib/analytics.ts` carries the same split as a bucketed `reason` param — the two call for opposite responses (curate around a catalogue gap; fix our own throttling), and reading the second as the first is what sent us hunting for songs that were never missing. Needs registering as a GA4 custom dimension before it appears in reports.
- The game page no longer re-asks for a track it already knows has no clip. `previewCache.current[id] ?? track.previewUrl` treated a cached `null` as "not asked", so every press of Play on a silent track re-ran the whole lookup; `undefined` now means "never asked" and `null` means settled.
- `getPlaylistWithTracks` ties its two concurrent calls to an `AbortController`. `Promise.all` rejects on the first failure and the route returns, but the losing half used to keep paginating afterwards — spending quota on a request nobody was waiting for, and emitting `console.error` with no request context. That is the whole explanation for "Spotify tracks fetch error" appearing under `/api/preview` in the production logs; `/api/preview` never called Spotify at all.
- `/api/playlist` returns **429 and 404 as themselves** instead of flattening every upstream failure into `400 + message`, and sets `Retry-After` on a 429. The client could not previously tell "your playlist is wrong" from "we are throttled", so the UI told throttled hosts to check their URL was public — sending them straight back into retrying against a spent quota. The 429 message now says the URL is fine and gives a wait.
- `submitToRoom` runs the duplicate-name and room-full checks against the record it already holds *before* fetching the playlist. Those rejections used to cost a full pagination and then answer 409. The authoritative re-check inside the write loop is unchanged; both now share `assertCanJoin`.
- Mixed mode's Start button loads contributor playlists two at a time (`MIXED_FETCH_CONCURRENCY`) instead of all 12 at once, and reports a 429 as a wait rather than as "remove or fix" the contributor's playlist.
- Every API route answers a failure as `{ error, code }` (and `retryAfter` where there is a wait) through one helper, `errorResponse` in `lib/api-error.ts`. `SpotifyApiError`, `RoomError` and `BuzzerUnavailableError` are constructed from a code rather than a message; their `message` is now the English rendering, kept for `console.error` and never for the UI. `enforceRateLimit` takes a code instead of a sentence.
- `submitToRoom` carries an upstream failure's code and status through instead of flattening every one into `422 + message`. A player submitting during a Spotify cooldown was being told their playlist was the problem — the same mistake `/api/playlist` was fixed for above, in the one place it was still being made.
- `/api/playlist` responses no longer carry `rawJson`. Every consumer already dropped it via `stripTrackForStorage`; keeping it made cache entries and response bodies roughly an order of magnitude larger than they needed to be.

### Known gaps

- `SPOTIFY_MAX_LOADS_PER_MINUTE`'s default of 40 is a guess. The right value depends on which quota tier the Spotify app is on, which the code cannot find out — hence the env var. Watch the hit-rate log for a week and tune.
- The global budget is a fixed window, so it can pass up to 2× the limit across a window boundary, same caveat as `lib/rate-limit.ts`. Acceptable: the cooldown catches the overshoot.
- `MAX_PLAYLIST_TRACKS` makes "All" mean "a random 500". Invisible for any playlist a party would realistically use, but it is a real behaviour change, and `truncated` is returned but not yet surfaced anywhere in the UI — a host with a 4,000-track playlist gets no indication they're playing a sample.
- Hit rate is logged and readable in-process but has no endpoint, so checking it means grepping Vercel logs. Deliberate: an endpoint would need an auth story for what is currently a two-line grep.
- Only *errors* are bilingual. The setup page, the game page and both join pages are still English, so a Chinese-speaking player now reads a Chinese error inside an English screen. That is the right order to do it in — an error is the one string that appears when someone is already stuck — but the rest of the UI is the obvious next piece.
- The language is read from `navigator.language` with no way to override it. Fine while only errors are translated; a real language switcher wants a stored preference, and `detectErrorLocale` takes its tag as an argument so that can be added without touching call sites.
- The buzzer Worker still sends an English `message` alongside its code. Harmless — the client renders the code and uses the message only for a code it doesn't recognise — but it means the Worker's strings are not covered by the translation test, since `lib/buzzer-protocol.ts` is shared verbatim with the Worker and must stay dependency-free.

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
