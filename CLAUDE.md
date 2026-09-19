# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Longer-form reference lives in [`docs/`](docs/README.md): [architecture](docs/architecture.md) (the system in diagrams), [viral-loop](docs/viral-loop.md) (the loop and how to read `npm run stats`), [operations](docs/operations.md) (deploys and what to do when something breaks), and [decisions](docs/decisions.md) (why it is like this, and what was rejected). This file stays the place for invariants and hazards — rules you must not undo. `docs/` is the place for explanation.

## Commands

```bash
npm run dev        # Start dev server on port 8000 (http://127.0.0.1:8000)
npm run build      # Production build
npm run start      # Start production server
npm run lint       # Run ESLint
npm test           # Run vitest suite (tests/)
npm run stats      # Print the viral-loop counters (needs the Upstash env vars)
```

Use `127.0.0.1:8000` (not `localhost`) — the Spotify app is configured for this origin.

**Run `npm run stats` at the start of any session about growth, the loop, retention, reliability, or "what should we build next", and lead with what it says.** It prints the playlist and preview cache hit rates alongside the loop counters — that is the number that says whether the app can afford its own traffic, and it sat at 26% for days before Spotify cut the whole app off in August 2026 because nothing read it. Not a nicety. The product's own telemetry went unread for eight weeks across four separate attempts to go and open GA4, and every feature decision in that period was made on an n of 1. The counters exist so that question has an answer; a command nobody runs is the same failure with a shorter path. If the Upstash variables are missing, say so and ask for them rather than reasoning from guesses.

**Read `docs/viral-loop.md` before interpreting the output.** Every number it prints is a floor — bar two: the quiz's `opened` and `board` are bumped on every `GET`, so they are ceilings and `completed ÷ opened` reads low — and the failure mode is reading a low one as "the CTA does not work" rather than "we could not see that it did".

## What This Is

**GuessSong** — a local party music guessing game built on **Next.js 15 App Router**. The host pastes a public Spotify playlist URL, adds player names, and plays short audio clips; everyone guesses out loud and the host awards points. **No login and no user accounts** — a single game's state lives in React state, handed off between pages via `sessionStorage`.

There *is* server-side storage, but it is deliberately narrow: a KV layer (`lib/kv.ts`) backed by Upstash Redis, used only for TTL'd data — Mixed Playlist Mode's rooms (`lib/room.ts`), Taste Quiz records (`lib/quiz-store.ts`, a week), IP rate limiting (`lib/rate-limit.ts`), the two upstream caches and the loop counters. Nothing is persisted per-user, and there are no tables or migrations. Local dev and tests fall back to an in-process `Map`, so neither needs a real Redis.

## Architecture

### Data Flow

1. **Setup** (`app/page.tsx`) — collects playlist URL, player names, clip duration (5–30s). On Start, calls `POST /api/playlist`, shuffles the returned tracks, writes the whole game payload to `sessionStorage` under the key `guesssong_game`, then navigates to `/game`.
2. **Game** (`app/game/page.tsx`, ~1200 lines, the heart of the app) — reads `guesssong_game` from sessionStorage on mount (redirects to `/` if absent) and runs a phase state machine:
   `waiting → playing → guessing → revealed → (next track | finished)`
3. **Audio previews** — Spotify deprecated `preview_url` (Nov 2024) and now returns `null` for *every* track on Client Credentials — measured 0/20 across four markets, which is why `Track` carries no `previewUrl` field at all. Every clip the game plays comes from iTunes or Deezer, resolved through `lib/preview-client.ts`. On mount it prefetches the whole game with one `POST /api/preview/batch`; anything that comes back unresolved falls back to `GET /api/preview` lazily, at the moment the host presses Play. Both search the **iTunes Search API** first and fall back to **Deezer**. Settled results are cached per track id in a ref (`previewCache`); tracks with no clip anywhere show a "no audio" state.

### API Routes (the only server code)

| Route | Purpose |
|---|---|
| `POST /api/playlist` | `{url}` → playlist name + tracks, via Spotify **Client Credentials** flow (`lib/spotify.ts`). Rejects Spotify editorial playlists (IDs starting `37i9` return 404 for new apps). |
| `GET /api/preview` | Track/artist/id → 30s preview URL (iTunes, then Deezer). No auth required. KV-cached by track id, including negative results. `&refresh=1` re-resolves a URL that stopped playing, on its own much tighter limit. |
| `POST /api/preview/batch` | `{tracks:[{id,name,artist,durationMs?}]}` → the same lookup for a whole game in one request. `durationMs` is optional so an older client still resolves; without it the pick falls back to matching on names alone. |
| `POST /api/room` | Creates a Mixed Playlist Mode room; returns room code, host token, expiry. |
| `POST /api/room/[code]/submit` | A player submits their playlist URL to the room. |
| `GET /api/room/[code]/status` | Poll for who has submitted so far. |
| `GET /api/room/[code]/pool` | Host consumes the room and gets the sampled, deduped track pool. |
| `POST /api/quiz` | `{url, ownerName?, questionCount, locale?}` → a Taste Quiz code. The feature's only Spotify-bearing step, through `loadPlaylist(url, "quiz-create")`. |
| `GET /api/quiz/[code]` | The quiz as a taker sees it — options without the answer key — plus the board. Counts the open. |
| `POST /api/quiz/[code]/check` | `{q, pick}` → `{answer}`, one question's answer the moment it is answered. Handed over only against a pick for question N, and records nothing — the board is still written once, by `answer`. `q === 0` counts `quiz:started`. |
| `POST /api/quiz/[code]/answer` | `{name, answers, hintsUsed?, submissionId?}` → graded against the stored key, one `hsetnx` row on the board; a resend with the same `submissionId` replays the row instead of refusing the name. |
| `GET /api/quiz/[code]/hint?q=N[&refresh=1]` | A clip of question N's real track, via `getPreview`. Exists so the phone never names the answer in a request; `refresh=1` is the rotted-URL repair path, on its own tighter limit. Counts its outcome (`quiz_hint:<status>`). |
| `GET /api/quiz/[code]/board` | The owner's results page: ranking, mean, per-question correct counts naming each real song. Host-token gated via the `x-host-token` header (403 `quiz_not_host`) because it is the answer key. Counts the open (`quiz:board`), after the gate. |

**A room is a Redis hash, and its writers claim a field rather than rewriting the record.** `lib/room.ts` stores `meta`, `consumed` and one `p:<folded name>` per contributor under `room:v2:<CODE>`, with each contributor's tracks in their own `room:v2:<CODE>:t:<folded name>` key. Four rules hold it together, and each replaces something that was actively wrong:

- **The claim is `hsetnx`, and there is no retry loop.** Read-modify-write on one blob cannot be made safe with get/set: the old code re-read before writing and read again afterwards to detect a clobber, which narrowed the window without closing it and cost four commands on the happy path. A QR room is a dozen phones submitting inside a few seconds, so this is the ordinary case.
- **`hsetnx` must not touch the key's TTL.** Redis leaves a TTL alone on a field write; a caller that "helpfully" re-set it on each submit would push the room past the `expiresAt` it already handed its clients, which is the same value the roster poll uses as its stop condition. `createRoom` calls `expire` once, and deletes the key if that call fails rather than leaking an immortal code.
- **Track payloads must stay out of the hash.** The roster poll runs every few seconds and needs names and counts; the blob made it drag every contributor's full track list across the wire to render a dozen chips. `consumeRoomPool` picks the track keys up with one `mget`, once.
- **`fold()` is the only place a name becomes a key.** It keys both the hash field and the tracks key, so a second spelling of the fold would let someone hold a roster slot under one key and write their tracks under another — visible in the room, absent from the pool.

The size cap is enforced at the pre-fetch check only. Re-enforcing it after the claim would mean rolling back a winner because a simultaneous submit pushed the count over, i.e. turning away someone who did arrive in time; the alternative it guards against is a room of thirteen instead of twelve.

**Taste Quiz is a loop surface with a game attached, and the key never leaves the server before an answer is in.** `lib/quiz.ts` (rules, pure, tested) and `lib/quiz-store.ts` (one hash per quiz, `quiz:v1:<CODE>`, mirroring `lib/room.ts`'s `hsetnx` claims) exist because the `share` arm had converted 0 of 50 and nothing link-shaped had been tried — `docs/decisions.md` D9. Seven things hold it together:

- **No audio in a question.** Two titles, one real — a duel, not a list. A clip is a *hint*: `GET …/hint` on tap only, rationed by `hintAllowance` (one per ten questions; it was one per five at four options, and at two a hint is a whole point), refunded when the clip cannot be found or fails to play, a tiebreak on the board rather than a penalty. Playing a clip per question would multiply the hottest path in the app by the number of friends. **Two options put chance at 50%, and three numbers are pinned to that:** `QUIZ_MIN_QUESTIONS` is ten (a coin lands 7/10 17% of the time, 15/20 2%), `verdictFor`'s lowest passing bucket is 60% so a coin never reads as "getting there" — the 50–59% band a coin lands in is its own `guessing` bucket, and `stranger` is below chance — and the question count is any integer 10–50 through `QUIZ_COUNT_CONTROL`, which hands `lib/song-count.ts`'s two rules the quiz's bounds rather than copying them.
- **`getQuizView` strips the key; `submitQuizAnswers` grades against the stored one and only then returns it.** A client that could read the key out of the network tab before answering makes the board meaningless. The hint route is the same rule one step on — `/api/preview?track=…` from the phone would put the answer in the request. What this does *not* protect against, and is not meant to: a throwaway name costs one row, and the decoys come from an open-source pool, so a determined taker can work the key out. It is a party toy; the wire just refuses to hand the key over unasked.

  **The per-question reveal is the same rule at question granularity, and it must stay a round trip.** A tap shows right or wrong at once, and the way it does that is `POST …/check` — the answer to question N against a pick for N, with the question locked on the phone before it asks and never reopened (Back shows an answered question; a reload puts it back locked, verdict included, from `revealed` in `lib/quiz-progress.ts`). Shipping the key with the view, obfuscated or not, so the reveal costs no request is the obvious shortcut and the thing the first rule forbids. The check is stateless — the board is still written once, from the sheet — so a devtools user can learn an answer and change theirs before submitting; that is the throwaway-name cheat in a different coat, not a new one. A check that fails (offline, 429, `CHECK_TIMEOUT_MS`) costs the verdict only: the question advances after the plain fill and the sheet is graded at the end, so the quiz never stalls on a round trip. `QUIZ_CHECK_LIMIT` is sized to a room of phones behind one address through a long quiz (600 per 10 min), not to the read limit; a refusal is silent on the phone by design, which is why `quiz_throttled:check` exists. **That limit is the largest single-address KV budget on the site**: 600 checks × 2 commands is ~173k commands a day from one address, against Upstash's monthly cap that once took the whole site down (`docs/operations.md` §5). It was kept at 600 on 2026-09-15 knowingly — a class of thirty through twenty questions is exactly what it is sized for, and the refusal counter is the instrument — so a non-zero `refused: check` in `npm run stats` is a number to read, not a bug, and lowering the limit is a product call about who gets no verdicts, not a hardening. The other half of a lost verdict (timeouts, offline, a slow KV) never reaches the server and is GA4's `quiz_check_lost`.
- **Decoys come from `lib/quiz-decoys.ts`, tiered, and never from the playlist.** Same artist, then any playlist artist, then same script and similar popularity, then same script, then anything. `displayTitle` strips qualifiers from the real option so " - Remastered" is not a tell, and **`titleKey` is the only place a title becomes a key** — the same rule as `lib/room.ts`'s `fold()`, for the same reason: "is this decoy already in the playlist" is decided by comparing these, and a title that keys differently on the two sides is the playlist's own song offered as the wrong answer. That is a bug that shipped, and it was reported exactly as "it is in the playlist but the quiz says it isn't": Spotify lists a mainland act's catalogue in Simplified where the pool is Traditional (Joker Xue's 演员 against the pool's 演員, so the same-artist tier served 演員 as the decoy for 演员), closes a qualifier with a full-width bracket (光亮（…主題歌）), and spells Play我呸 without the space. `titleKey` therefore folds qualifiers, NFKC, case, whitespace, punctuation and Traditional→Simplified (`lib/cjk-fold.ts`, a generated character table — regenerate with `scripts/gen-cjk-fold.mjs`, never edit; **the generator chases every target to a fixpoint because OpenCC's raw tables chain 麼→么→幺**, which keyed 怎麼了 and 怎么了 apart, and `tests/cjk-fold.test.ts` pins closure over the whole table), `foldText` runs an artist credit through the same Traditional→Simplified fold (case, whitespace and NFKC only otherwise) so a Simplified 周兴哲 reaches the pool's 周興哲 alias, and both are deliberately loose: two songs that fold together cost one decoy, one song that does not fold together costs a point. What it cannot fold is a translation, so a pool title must be the one Spotify lists — K-pop is English there ("Spring Day", not 봄날) — with any other spelling in `aka`, which excludes and is shown when the real option is in its script (`displayDecoyTitle`). `tests/quiz.test.ts` drives the production pool against Spotify's own spellings for fourteen of them. `scriptBucket` is derived from the strings on both sides; do not hand-tag the pool. A second Spotify call for decoys is deferred until `quiz_verdict:*` piles at `soulmate`. A playlist over `MAX_PLAYLIST_TRACKS` is sampled, so its exclusion set is the sample's — a known gap, not a fold problem.
- **A taker's row is one `hsetnx` on `s:<foldQuizName>`, keyed off `quiz.meta.code` and never the route parameter, and it must not touch the TTL.** `loadQuiz` trims and upper-cases the segment; a write that keyed off the raw parameter sent `/api/quiz/%20ABCDEF/answer` into `quiz:v1: ABCDEF`, a fresh hash with no expiry — one immortal orphan per whitespace variant, with the taker told they were recorded. `quizKey` takes the canonical code only. `createQuiz` calls `expire` once and deletes the key if that fails. The 50-row cap is advisory (grade, show, don't write), for the room's reason: never roll back a winner. The row carries `right` (which questions were correct) for the owner's per-question rates; it must never carry which option was picked, and `publicScore` strips it from everything a taker receives.
- **`/q/[code]/board` is host-only, and that gate is what lets it name the answers.** The per-question rows are the key. The token lives in the creating device's `localStorage` (`rememberQuizToken`) and nowhere else; the public ranking on `/q/[code]` is what everyone else gets. Do not "helpfully" make the board public.
- **It never calls `recordHostedStart`, and opens are counted by the API, not by `generateMetadata`.** A quiz is not a party; the unfurler in every chat app fetches the page's metadata. `recordQuizStage` / `recordQuizVerdict` in `lib/loop-stats.ts` are the authoritative funnel; `quiz_result` in `lib/loop-links.ts` is the surface, kept apart from `share` so a warm link is never averaged with a cold QR.
- **The link's card names the quiz, and three things had to change for it to.** (1) `app/q/[code]/page.tsx` sets `alternates: { canonical: /q/<code> }` and `openGraph.url` on the found branch and `alternates: { canonical: null }` on the fallback — a nested `generateMetadata` inherits every top-level key it does not set, so without these the page carried the root layout's `<link rel="canonical" href="https://www.guessong.app">`, and Facebook resolves a canonical before it reads a card: a quiz shared there unfurled as the *home page*, title and picture, with the owner's name nowhere. (2) `/q` is **not** in `app/robots.ts`'s disallow list and must not go back: Facebook and X honour robots.txt when they unfurl, and a disallowed quiz link drew no card at all on the platforms a link gets posted to. `app/q/layout.tsx`'s `noindex` is what keeps every `/q/*` page out of the index instead. (3) The image is `app/q/[code]/opengraph-image.tsx`, rendered per quiz — the one generated image that is deliberately `ƒ`, see "SEO / Metadata". `tests/quiz-unfurl.test.ts` and `tests/site-policy.test.ts` pin all three.
- **Every quiz route writes its own counter, and every key tail comes from a closed set.** `recordQuizCreated` (stage, `quiz_len:created:<n>`, `quiz_locale:<l>`, `quiz_clamped`), `recordQuizStage("started")` on the check for question zero (the first half tapped, once per attempt — it splits `opened → completed` into the intro's drop and the quiz's), `recordQuizCompleted` (stage, verdict, `quiz_len:completed:<n>`), `recordQuizHint` (`quiz_hint:<PreviewStatus|refresh>`), `recordQuizStage("board")`, and `recordQuizThrottled(<route>)` on every `enforceRateLimit` refusal. Each guards its value against the union it is typed with — the count against the schema's bounds, refusing rather than clamping — because a key tail from a request body is an unbounded key space. Three things about them that fail silently: **a new key under a prefix `scripts/loop-stats.mjs` already renders (`quiz:`, `quiz_len:`, `quiz_hint:`, …) is consumed and printed nowhere** — it needs its own line in the quiz block, the "Other counters" fallback only catches new prefixes; **a route that stops calling its recorder answers exactly as before** — `tests/quiz-routes.test.ts` reads the counters back from the in-process KV after driving the six routes, and pins its env to the Map because it is the one test that would *pass* against production and inflate the numbers decisions are made from; and `bump` claims the liveness memo *before* its write so the `Promise.all` recorders do not each pay for the marker.

**Every route is IP rate limited** via `lib/rate-limit.ts` (fixed window on top of `lib/kv.ts`'s atomic `incr`). When adding a route, follow the existing pattern: module-level `X_LIMIT` / `X_WINDOW_SECONDS` constants, then `rateLimit()` → 429 before any expensive work.

**`rateLimit` must fail open, and it is the one KV consumer where that reads backwards.** A limiter looks like the place to fail *closed*, and that reading took the whole site down: `enforceRateLimit` runs at the top of every route *before* its own `try`/`catch`, so a throwing `incr` escaped the handler and Next answered a bare 500 with an empty body — no `code`, so hosts were told to check a playlist URL that was fine. The trigger was Upstash's monthly command cap being spent, which fails every command for days rather than seconds. Giving up the per-IP ceiling is the cheap half of the trade: the limits mostly blunt guessing against `lib/room.ts`'s 4-char code space, and rooms live in the same KV that is already gone. Spotify and iTunes keep their own ceilings in `lib/playlist-cache.ts` / `lib/preview-cache.ts`. Symptom and what still degrades: `docs/operations.md` §5.

Three caches keep upstream request volume flat as traffic grows:
- **Preview cache** (`lib/preview-cache.ts`) — KV, keyed by track id. Caching misses is the point: tracks with no preview anywhere are the most repeatedly queried, and each uncached miss costs 5 upstream calls. See "Previews are per-track" below, which is the whole reason this is the hottest path in the app.
- **Playlist cache** (`lib/playlist-cache.ts`) — KV, keyed by playlist id. 24h on a full playlist, 1h on a sampled one. Six hours was the original figure and it was too short by exactly the wrong margin: parties are nightly, so a playlist first loaded at 8pm was cold again by 8pm the next day. The cache held ~406 warm keys against 2,152 cold loads a day, a 26% real hit rate, and every miss spent the shared quota. **Every caller must go through `loadPlaylist`, never `getPlaylistWithTracks` directly** — a single uncached path is enough to put the shared quota back at risk.
- **Spotify token cache** (`lib/spotify.ts`) — module scope, so per-lambda-instance rather than global. Deliberately *not* in KV: a token is the one thing with no fallback, so a KV outage on that path would take down playlist loading entirely. A 401 clears the cache and retries once.

### Spotify's quota is per app, not per IP

This is the constraint the whole playlist path is shaped around, and it is the opposite of how `lib/rate-limit.ts` works. Spotify throttles on the **client id**, so every visitor shares one budget, while every route limiter is keyed by IP and hands each new visitor a fresh allowance. Per-IP limits bound one abusive client; they do nothing about aggregate load. `lib/playlist-cache.ts` is what bounds the aggregate, in three layers:

- **Cache** — a repeat playlist costs zero upstream calls.
- **In-flight coalescing** — concurrent loads of the same playlist collapse into one fetch, per lambda instance. Mixed mode fires one request per contributor from one click, and a QR room gets a burst of simultaneous submits; the cache write lands too late to help those siblings.
- **Global budget** (`SPOTIFY_MAX_LOADS_PER_MINUTE`) — a KV `incr` counter shared across instances, refusing new playlists *before* Spotify does. Fails open on a KV error: losing the safety net must mean "back to how it was", not "nobody can play".
- **429 cooldown** — when Spotify does refuse, all uncached loads are parked for `Retry-After` (clamped 30s–24h), in KV so every instance sees it. **The stored duration and the key's TTL are two different numbers, and merging them back is the bug this replaced.** Spotify's `QUOTA_EXCEEDED` carries a Retry-After in the tens of thousands of seconds — measured 52531, i.e. 14.6 hours — because what is spent is a daily app quota, not a burst window. The old code clamped that to 15 minutes and so promised the host a wait it could not honour. Now the value is honest and reported; `COOLDOWN_PROBE_SECONDS` (15min) is the TTL, so the gate still reopens on schedule and a refused probe rewrites the cooldown from a fresh header, which is what stops one bad Retry-After parking the site for a day. Without this a throttled window is self-sustaining: every host errors, every host retries, the retries keep the quota pinned. Cached playlists keep serving throughout, so a party mid-game is unaffected by someone else's throttling.

Three rules that follow from this, and are easy to undo by accident:
- **The playlist object carries the first track page, and asking for it twice is not free.** `GET /playlists/{id}` returns the first 100 tracks embedded in its own reply, which is why `fetchPlaylistHead` requests `fields=id,name,tracks(...)` and hands that page to `fetchPlaylistTracks` rather than letting it fetch `offset=0` itself. Splitting these back into a `Promise.all` over two requests — which is what the code did until 1.7.1, and which looks faster — spends one wasted upstream call on *every* cold load. Measured on Spotify's dashboard it was ~45% of every request the site made. It also brings back the `AbortController`: two concurrent requests under a `Promise.all` mean the losing half keeps paginating after the response has gone out.
- **Never flatten an upstream 429 into a generic 400.** The client has to be able to tell "your playlist is wrong" from "we are throttled" — the original bug told throttled hosts to check their URL was public, which sent them straight back into retrying.
- **`fetchPlaylistTracks` reads at most `MAX_PLAYLIST_TRACKS` (500), sampling random pages when a playlist is bigger.** Following `next` unbounded made one big playlist cost 40+ requests for a game that plays at most 50 songs. A miss logs `[playlist-cache] miss id=… source=… misses=…`; the cumulative rate is `getCacheStats()`, on demand.

Two things about reading that line, both of which have already cost a debugging detour:
- **Trust `source=`, not the log row's method.** Only `POST /api/playlist`, `POST /api/room/[code]/submit` and `POST /api/quiz` can produce it, but Vercel attributes a line to whichever request the instance was serving, so it often appears against an unrelated `GET`. New callers of `loadPlaylist` should pass a `PlaylistLoadSource`; the default logs `source=unknown`.
- **`getCacheStats()` counts a replayed 404 as a hit** — correctly, since it answered without touching Spotify — so a host retrying a dead link pushes the rate *up*. `negativeHits` is that subset, and `hits - negativeHits` is the part that describes real playlists. The bucket is a **UTC** day, so a rate read soon after 00:00 UTC is measuring almost nothing.
- **A log line must not read a counter back to compose itself.** Both cache modules used to spend two extra KV reads per miss printing a cumulative rate, on the exact path that is already the expensive one. Cumulative numbers belong in `npm run stats` and the `*CacheStats()` accessors, which are asked once by someone who wants them; a log line reports the request it belongs to.

### Previews are per-track, which makes them the hotter path

`lib/preview-cache.ts` is the same shape of problem as the section above, an order of magnitude worse. Spotify is called once per *playlist*; iTunes and Deezer are called once per *track*, so a cold 50-song game is 50 lookups of up to 5 upstream calls each. Both throttle per IP, and a serverless deploy's egress IPs are shared — from iTunes' side the entire user base is one very noisy client. Per-IP limiting does nothing about it, for the reason spelled out above.

The same three layers, so they read the same way: cache → global budget (`PREVIEW_MAX_LOOKUPS_PER_MINUTE`, counted in *lookups*) → per-source cooldown, all fail-open, all in KV so every instance sees them. `[preview-cache] miss hits=… misses=… unavailable=…` describes that request; `getPreviewCacheStats()` has the day's totals.

**The cooldown is memoized in module scope, and it must not go back to a KV read per track.** It is a site-wide, minute-scale signal that `askUpstream` consults once per source *per track*, so a cold 25-song game spent up to 50 reads learning the same two answers — more commands than the batch's own writes. A known-future `until` is trusted without re-reading at all; "not cooling" is held only `COOLDOWN_MEMO_MS`, because that is the answer that spends upstream calls, and the in-flight map is what makes the first wave of a batch share one read instead of each worker issuing its own. `startCooldown` primes the memo, so within an instance a 403 parks the source immediately; across instances a cooldown is joined up to `COOLDOWN_MEMO_MS` late, which is deliberately far below `MIN_COOLDOWN_SECONDS`.

Seven things here are easy to undo by accident:

- **The title-only queries verify the artist; the ones that carried it upstream must not.** Each source is asked progressively looser questions and the last drops the artist, so upstream ranks by popularity alone and returns the best-known song with that title — iTunes answers "Hello" with Pinkfong's nursery rhyme and "Alone" with Heart. Accepting one caches the wrong recording as `found` for a year, which refresh never re-picks, and the clip then contradicts the answer card. Those queries require the candidate to be tied to the request by *either* a matching credit or a matching running time, and otherwise hand over to the next source. Applying the same check to the artist-carrying queries looks like an obvious tightening and is a catalogue-wide outage for CJK: iTunes returns 小幸運 as "A Little Happiness" by "Hebe Tien" where Spotify says 田馥甄. `artistMatches` is only ever a veto where upstream had no artist signal of its own.

  **A caller that sent no artist at all is the third case, and it used to fall through both.** With no artist the first query has already degraded to the bare title, so the guarded follow-up is byte-identical and is skipped as a duplicate — which left the *unguarded* half as the only thing that ran. `titleOnly` carries `requireVerified: Boolean(query.durationMs)`: demand the clock when the caller sent one, keep the old behaviour when they sent neither, because manufacturing a week-long `absent` for a track that may well have a clip is the worse failure.

- **`artistMatches` compares the acts a credit names, never substrings.** Plain containment let "Hello Adele Tribute" read as Adele, and a tribute act titled exactly right is what a popularity-ranked search surfaces — confirmed live as the *second* iTunes result for "Hello Adele" — so it landed in the strongest tier and won on running time. `creditParts` splits on how both platforms bill a collaboration and one credit has to name every act the other does, which keeps "Marshmello & Noah Cyrus" matching Marshmello. Two boundaries in `CREDIT_SEPARATOR` are load-bearing: alphabetic separators need `\b` or "Charli XCX" splits on its own x, and a leading "the" comes off because iTunes bills "The Beatles" where Spotify says "Beatles". CJK keeps the plain substring, having no spaces to anchor on.

- **`QUALIFIER_SUFFIX` is anchored far more tightly than it looks like it needs to be, and loosening it reopens the bug it fixed.** Spotify stores "Karma Police - Remastered 2011" where iTunes has plain "Karma Police", so a qualifier-stripped `looseName` tier sits between "same artist and title" and "same artist" — without it a remaster matches no tier and the clock picks among the artist's own album tracks. But `[-([]` followed by a lazy reach for the keyword truncates at the *first* hyphen, which stripped "Hip-Hop Is Dead (Remastered)" to "Hip" and outranked a candidate whose running time agreed to the millisecond: a new wrong-clip path opened by the fix for wrong clips. The `\b` around the alternation is the same story one size down — without it "live" fires inside "Alive" and "mix" inside "Remix". `looseName` is deliberately **not** shared with `lib/mixed-playlist.ts`'s `fingerprint()`: a dedupe key can afford the over-merge of the loose qualifier reach that a clip picker cannot. **Both must keep a Unicode alphabet (`\p{L}\p{N}`), never `[a-z0-9]`.** `fingerprint()` shipped with the ASCII form and it took every Chinese, Japanese and Korean title to the empty string, so a Mandopop Mixed room pooled to one track per artist and every song by a natively credited act (告五人) merged with every other — silently, since a short pool is just a short game. `tests/mixed-playlist.test.ts` pins that eleven Mandopop tracks pool to eleven.

  The tier order in `pickCandidate` is pinned by `tests/preview.test.ts` and is not arbitrary. The duration tier stays *above* the bare-title tiers: an exact title whose running time is 52s out is a cover, and the recording asked for is the one whose clock agrees. Each candidate is scored once and the tiers read the verdicts, because the tier loop re-filters per tier and re-parsing upstream's strings for an answer that cannot change is regex work on the hottest path in the app.

- **`absent` and `unavailable` are not the same null, and collapsing them is a real bug that shipped.** `absent` is a fact about the recording — nothing has a clip — and is cached a week. `unavailable` is a fact about *us*: throttled, out of budget, or the request never got through. The old route mapped every failure onto `previewUrl: null` and cached it for seven days, so one throttled minute at peak marked a slice of the catalogue silent for a week, and it never reproduced locally because a laptop's own IP is never the one being throttled. Only a clean, complete reply from upstream may produce `absent`; everything else is `unavailable`, cached 90 seconds. A wrong `absent` lasts a week and is invisible, a wrong `unavailable` costs one retry. **The client half has the same rule** (`lib/preview-client.ts`, and `previewCache` in the game page stores settled answers only).
- **iTunes signals throttling with `403`, not 429, and Deezer puts its quota error in the body of a `200`.** Reading only 429, or only the status, is how a refusal gets classified as "no result" in the first place.
- **The cache key is deliberately unversioned**, unlike `lib/playlist-cache.ts`'s. The record is a strict superset of the `{previewUrl}` shape that shipped before it, so legacy entries still read as valid hits. Bumping a version would cold-start every entry in production simultaneously — precisely the upstream burst the module exists to prevent. For the same reason, legacy nulls are read as `absent` even though some are poisoned by the old bug: they age out within a week, and re-resolving all of them at once is the stampede that poisoned them.

- **Both preview routes clamp `track`/`artist` through `clampPreviewField`, and they must agree or one key holds two answers.** The matching above is regex work on strings an unauthenticated caller hands over, and two of those regexes are super-linear on pathological input — a run of 16k spaces measured at 141ms in one credit split, once per candidate per tier. `PREVIEW_FIELD_MAX` (300, in `types/preview.ts`) bounds the input at the boundary rather than defending in every consumer, and Spotify's own fields sit far under it, so nothing real is truncated. **Clamp by code point, never `slice`**: UTF-16 units cut a surrogate pair in half, a lone high surrogate makes `encodeURIComponent` throw `URIError`, and that throw happens inside the batch's `Promise.all` — one emoji landing on the boundary costs all sixty tracks their previews and answers the bare 500 with no `code` that this project has been bitten by before.

Positive entries are held a year, because a recording does not change. What does change is the URL — the clips sit on a CDN that rotates them — so the entry has to be *repairable* rather than merely expiring: the stored `itunesTrackId` lets `&refresh=1` re-resolve with one `lookup?id=` call instead of the five-call search fan-out, and the game page fires it from the `<audio>` element's `error` event, once per track. Drop the refresh path and the year-long TTL becomes a year of dead URLs.

### Scoring

The host is the judge — there is no automated answer checking. Correct song guess = host taps the player → **+3 pts**; album name = **+1 pt**. One award of each type per round, guarded by `pointsAwarded` / `albumPointsAwarded` flags.

### SEO / Metadata

Production domain is `https://www.guessong.app` (fallback in `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts`). `app/layout.tsx` also injects GA4 when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set.

**AdSense's loader lives in `app/layout.tsx`'s `<head>`, not in a `next/script`.** Google's site review looks for it there, and `afterInteractive` would inject it into the body instead. It renders only when `NODE_ENV === "production"`, so `next dev` never reports impressions against the account. `public/ads.txt` carries the same publisher id with the `ca-` prefix stripped — AdSense flags "Earnings at risk" if the file is missing or the two disagree, so changing `NEXT_PUBLIC_ADSENSE_CLIENT_ID` means changing both.

**The five generated images must stay build-time, which means none of them may declare `runtime = "edge"`.** `app/opengraph-image.tsx`, `app/icon.tsx` and the three sizes of `app/icons/[size]` are rasterised by satori, the most CPU-expensive thing the app does. All three carried `runtime = "edge"` from the day they were written until this was found, and edge *disables static generation for the route* — Next says so in a build warning that is easy to read past ("Using edge runtime on a page currently disables static generation for that page"). They were `ƒ` in the route table, ran per request as `edge-function`, and showed up in production logs as `cache: MISS`. The fix was deleting three lines; the output bytes are identical either way, so nothing about this is visible on the page and nothing but the route table will tell you it regressed. `app/icons/[size]` additionally needs its `generateStaticParams` + `dynamicParams = false` to stay — that pair is what prerenders the three sizes and 404s everything else without an invocation.

After touching any of them, check `npm run build`'s route table: `/icon` and `/opengraph-image` must be `○`, `/icons/[size]` must be `●` with all three sizes listed under it. An `ƒ` there is the regression.

**`app/q/[code]/opengraph-image.tsx` is the one exception, and its `ƒ` is deliberate.** The quiz link's card is most of what a friend sees in the chat, and a picture selling the party game under a title naming the owner read as canned. It is rendered per quiz because the owner's name is in KV, not in the build — and what keeps it off the hot path is not the runtime but the header: the route sets its own lower-case `cache-control` with `s-maxage` (a day for a quiz that exists, a minute for one that does not), which Vercel's edge honours, so a quiz's card is rendered once per region per day rather than once per unfurler. `ImageResponse`'s default `immutable, max-age=31536000` only ever cached it in a browser an unfurler is not. Three things bound what the header cannot (the edge only knows the exact URL, so a query string or a lower-case code is a fresh render): a malformed code is sent to the static `/opengraph-image` without touching KV or satori, a non-canonical spelling is sent to the canonical image URL (and `app/q/[code]/page.tsx` sends the page the same way, so a quiz has one cache key), and what remains is counted against `quiz:card` per address — 60 per 10 min, refused renders also falling back to the static card — because a metadata image is a route and every route is limited. The CJK font is fetched by the route itself (Noto Sans TC, subset to the card's text, 4s timeout) and its outcome chooses the header: `next/og`'s own loader fails soft into `.notdef` boxes under whatever header was already chosen, which would pin a tofu card at the edge for a day. Supplying `fonts` replaces the bundled Latin face, so the subset covers every string on the card; `lang="zh-TW"` still goes on the text or satori reaches for Noto Sans JP first. No emoji and no `runtime = "edge"`. `tests/quiz-unfurl.test.ts` pins the header, the key's case, the two cache lengths' order, the limiter, the redirects and the font rule.

### Content pages — the guides, and the policy pages AdSense looks for

`/guides` and its articles, plus `/privacy`, `/terms`, `/contact` and the `/zh` half of the first two, exist because AdSense refused the site under "Low value content" in August 2026. Before them the site had three indexable URLs, two of which were near-duplicates of the first, and no privacy policy at all on a page loading both AdSense and GA4. `CHANGELOG.md` 1.7.0 has the full diagnosis.

Four rules hold this together, and each replaces something that fails silently:

- **`lib/guides.ts` declares a guide once, and four things derive from it** — the route, the `/guides` index, `app/sitemap.ts`, and the "read next" links on its siblings. Hand-syncing those fails the same way `lib/loop-links.ts` does: a guide missing from the sitemap is a page Google never comes back for, and nothing on screen says so. `tests/guides.test.ts` asserts every slug has a directory and vice versa, that each article's own `SLUG` constant matches its path (a copy-pasted article that kept the source's constant renders the wrong canonical under the right URL), and that every guide has at least one inbound sibling link.
- **`requireGuide`, `guideMetadata` and `formatGuideDate` live in `lib/guides.ts`, not beside the component that calls them.** Same reason `lib/song-count.ts` gives: the suite only reaches `lib/`, and vitest cannot import a `.tsx` module here. `app/guides/guide-shell.tsx` re-exports `guideMetadata` and keeps only the JSX. Moving that logic back into the shell silently drops it out of test range.
- **`components/site-footer.tsx` is the only place the policy pages are linked from.** It replaced three hand-rolled `<footer>` blocks. A reviewer — Google's or a player's — looks for the privacy policy in the footer, and a page that omits it reads as a page that does not have one; three copies is three chances for one page to lose the link by being edited alone. `tests/site-policy.test.ts` pins that `/`, `/about`, `/zh` and `/quiz` all render it, that both privacy pages name AdSense, Analytics and cookies and carry the opt-out link, and that the `/zh` footer contains no English label.
- **`CATEGORY_BLURB` in `app/guides/page.tsx` is keyed by `GuideCategory`, not `string`.** A new category with no blurb has to be a compile error, not an `undefined` rendered under the heading — the same rule `lib/error-messages.ts` follows for its translation table. `GUIDE_CATEGORIES` is still ordered by hand, and a category added to the union but not to that array makes its guides unreachable from `/guides`; the partition test is what catches that, not the compiler.

**The guides are English only, deliberately.** `/zh` is written natively rather than translated, so eight translated articles under it would be the one seam in the thing that page is for. The policy pages are bilingual because those have to be readable by the person they bind. `/zh`'s footer links to `/guides` under a Chinese label and lands in English — a known seam, kept because hiding the section from Chinese readers is worse.

**A language pair goes through `languageCluster()` in `app/sitemap.ts`, never two hand-written entries.** The rule it enforces — every URL in a cluster carries the identical annotation set, because a one-sided declaration is a weaker signal than none — was written as a comment at the top of that file and then broken three entries below it, on the policy pages, in the release that added them. The helper computes the set once and gives it to both halves. `tests/guides.test.ts` asserts every alternate a sitemap entry names is itself in the sitemap with a matching set, and `tests/site-policy.test.ts` parses each policy page's `languages` block for all three tags rather than merely grepping for the word.

`/guides`, `/privacy`, `/terms`, `/contact` and `/quiz` must stay out of `app/robots.ts`'s disallow list. That list is for ephemeral room codes and the counting redirect; a content page landing in it would be invisible to exactly the crawler it was written for. `/q` stays out too, for the unfurlers' sake (above) — a quiz link is kept out of the index by `noindex`, not by robots — and it has a second reason now: disallow entries are *prefixes*, so a `/q` coming back would hide `/quiz`, the one indexable page the quiz has, along with the links. `tests/site-policy.test.ts` asserts all of it, parsing the list as prefixes rather than grepping for the path.

## Environment Variables

```
SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   # Required — Client Credentials only, no redirect URI
UPSTASH_REDIS_REST_URL / _TOKEN             # Required in production — see below
NEXT_PUBLIC_BASE_URL                        # Optional — defaults to https://www.guessong.app
NEXT_PUBLIC_GA_MEASUREMENT_ID               # Optional — enables GA4
NEXT_PUBLIC_ADSENSE_CLIENT_ID               # Optional — AdSense publisher id, defaults to ca-pub-2238954049312975
SPOTIFY_MAX_LOADS_PER_MINUTE                # Optional — global upstream burst ceiling, default 40
SPOTIFY_MAX_LOADS_PER_DAY                   # Optional — global ceiling per rolling 24h, default 2000
SPOTIFY_BUDGET_WARN_RATIO                   # Optional — fraction of the daily ceiling that triggers the heads-up notice, default 0.8
PREVIEW_MAX_LOOKUPS_PER_MINUTE              # Optional — global iTunes/Deezer ceiling, default 120
NEXT_PUBLIC_BUZZER_WS_URL                   # Optional — the buzzer Worker; unset hides Buzzer Mode
```

**`socketUrl` folds `http(s)://` into `ws(s)://`, and that fold must stay.** Production's `NEXT_PUBLIC_BUZZER_WS_URL` is `https://`, the README says `wss://`, and only browsers newer than early 2024 accept the first inside `new WebSocket()`; everything older throws from the constructor, inside the connect effect, and a phone that taps Join Room lands on the crash screen while the host reads "Nobody has scanned yet". `docs/operations.md` "The host opened the room and nobody joined".

**`buzzerWorkerUrl()` in `lib/buzzer-client.ts` is the only reader of that variable, and it trims.** `isBuzzerConfigured` (the toggle on `/`), `httpOrigin` (the host's one `POST`) and `socketUrl` (the phone's socket) all go through it, so the three agree on what "no Worker" means: a blank or whitespace-only value hides the toggle *and* makes `socketUrl` return null, where a second reading would hand `new WebSocket()` a bare `/rooms/<code>/ws` (a relative URL, the same crash) and send the host's POST to the page's own `/rooms`. The trim is not tidiness: a leading space pasted into the dashboard field misses the `://` anchor of both folds while the URL parser strips it, so a new browser connects, the host's POST succeeds, nothing on a developer's machine notices, and the old constructor throws on it, the crash back from one character. `httpOrigin` is the same fold in the other direction (`ws(s)://` into `http(s)://`, anchored, case-insensitive), and the two must stay mirrors so either spelling names one Worker from both sides. `tests/buzzer.test.ts` pins all of it against the production value.

Without the Upstash pair, `lib/kv.ts` falls back to an in-process `Map`. That is fine for `next dev` and tests, but **not** for multi-instance serverless deploys: rooms created by one lambda would be invisible to another, rate limit counters would reset per instance, and the preview cache would lose most of its hit rate.

## Release Notes — two changelogs, both hand-written

A release updates **both** of these, and they are not the same document:

- `CHANGELOG.md` — the maintainer's record. Technical, names files and functions, carries a "Known gaps" todo list.
- `lib/changelog.ts` — what players read in the footer's "What's new" overlay (`components/changelog-modal.tsx`, on `/`, `/about`, `/zh`). Plain language, and **bilingual**: every entry needs `text` *and* `textZh`, plus `headline` and `headlineZh`. `/zh` is written natively rather than translated, so an English string leaking through there is a visible defect, not a fallback.

`tests/changelog.test.ts` enforces what it can: newest-first ordering, both languages present and different, valid dates, no markdown, and `LATEST_VERSION === package.json`'s version. That last one means **bumping `package.json` without adding an entry to `lib/changelog.ts` fails the suite** — deliberately, because the overlay prints that version to users and `changelog_opened` files reads under it.

## Error messages — codes, not sentences

`lib/error-messages.ts` is the only place a user-visible error string exists: one `AppErrorCode` union and one `Record<AppErrorCode, {en, zh}>` table, so a missing translation is a compile error. Add an error by adding a code, never by writing a sentence at the throw site.

**The server sends `{ error, code }` and the client picks the language.** Routes build that with `errorResponse` (`lib/api-error.ts`); `SpotifyApiError`, `RoomError` and `BuzzerUnavailableError` are constructed from a code, and their `message` is the English rendering — it is for `console.error`, never for the UI. Localising server-side would be wrong three ways: one room is read by several devices, `/api/playlist` is called on behalf of other people's phones in Mixed mode, and `lib/playlist-cache.ts` caches 404s, which would freeze one language into the cache for everyone.

Clients render with `errorMessage` / `describeError` and get the locale from `useErrorLocale()` (device language, resolved in an effect so the server-rendered join pages don't hydrate against a different string). `apiError(body, fallbackCode)` turns a failed response into an `AppError`; the fallback should name what the caller was doing, not `unknown`.

Four things `tests/error-messages.test.ts` will catch, all easy to do by accident:
- **A placeholder only exists if its callers pass params.** `{seconds}` with no `params` renders literally at the player, so the test pins the exact set of codes allowed to have one.
- **No throttling message may blame the host's playlist**, in *either* language.
- **`spotify_quota_exhausted` must stay free of `{seconds}`.** It is the code for a wait measured in hours, and a countdown that long is a promise the app cannot keep — the host waits it out, presses Start, and lands on the same refusal. `cooldownError` picks it above `COUNTDOWN_MAX_SECONDS`; `retryAfterSeconds` stays honest either way, because that is a header and not a sentence. That is the `spotify_*` hazard documented above, and a translation is just as capable of reintroducing it.
- **No throttling code may join `isDeterministicPlaylistFailure`.** That predicate names the codes where resubmitting the identical URL provably cannot answer differently — the URL is malformed, or `lib/playlist-cache.ts` is replaying a 404 it will keep replaying for `NOT_FOUND_TTL_SECONDS`. `app/page.tsx` uses it to re-show the error the host already has instead of spending a request to be told it again, keyed on the exact URL string so editing the link needs no explicit reset. This is the same `spotify_*` hazard one step further on: a spent quota clears by itself, so listing a throttling code there would strand a host whose playlist was always fine behind a button that has quietly stopped asking. `playlist_load_failed`, `unknown` and `server_error` stay out for the mirror-image reason — "we don't know" must not harden into "don't ask".

  Why it exists: a refused playlist returns from the negative cache in ~100ms, which is faster than the Start button re-enables, so a host mashing Start on a private link generated bursts of fourteen identical `POST /api/playlist` calls 150–300ms apart. In a two-minute production log sample those 404s were **78% of all billed function invocations** — the single largest consumer of the Vercel Active-CPU budget, well ahead of anything doing real work. Nothing upstream was being hit; the cost was the invocations themselves, which is exactly the class of waste a per-IP rate limit does not catch (the bursts sat comfortably inside the 30-per-10-minute allowance).

- **The two quota codes must say the app is free, that the quota is not for sale, and where to go instead** — in both languages. A host told only "the allowance is gone" is left with two readings and both are wrong: that nobody is looking after the site, or that money would fix it. Spotify sells no bigger quota to a project this size, so an apology and an honest account is the whole of what is on offer, and the open-source line is the only real remedy in it. `components/service-notice.tsx` renders that last part as a link (`SELF_HOST_URL`) rather than prose, because the same string is also shown as plain text under the Start button where nothing is clickable. The test pins apology, "free" and "open source" on both `spotify_quota_exhausted` and `spotify_daily_budget_spent`, in `en` *and* `zh` — a translation is where the awkward second half of a sentence gets dropped.

The buzzer Worker keeps its own wire codes (`BuzzerErrorCode` in `lib/buzzer-protocol.ts`, which is shared verbatim with the Worker and must stay dependency-free). `BUZZER_ERROR_CODES` maps them onto app codes — that mapping is the only thing connecting the two, so a new wire code needs an entry there.

## A client-side throw must never be a dead end

`app/error.tsx` and `app/global-error.tsx` exist because there was no error
boundary anywhere in `app/`, and the cost of that is on record: an uncaught
throw on the path from Start to `/game` replaced a host's party with Next's
default — *"Application error: a client-side exception has occurred (see the
browser console for more information)"* — which names no cause, offers no
action, and reported nothing anywhere. It was found from a user email, not from
telemetry. **Deleting either boundary restores that**, and nothing on screen
will say so until the next report arrives.

Three rules hold the Start → `/game` path together, and each replaces something
that shipped:

- **`parseGamePayload` validates the track list; it must never go back to
  `as Track[]`.** The game page dereferences `t.artists[0]` in its
  preview-prefetch effect on mount, so one entry without an `artists` array was
  a TypeError there and the whole page died. `normalizeTrack` repairs what a
  game can play without (`artists` → `[]`, `durationMs` → `0`) and drops only
  what it cannot (no `id`, no `name`). That split is the same rule `GAME_MODES`
  follows and for the same reason: a payload already in a host's sessionStorage
  has to keep playing across a deploy, not fail to parse mid-party.
- **`lib/game-storage.ts` is the only path to the game payload.**
  `sessionStorage` *throws* rather than returning null in a locked-down browser
  — Safari with "Block All Cookies", several embedded webviews — and the throw
  is on the property access itself, which is why the `try` wraps the access and
  not just the call. `lib/host-session.ts` documented this and guarded
  everything it owned; this payload was the one path that did not.
- **A refused write is `storage_blocked`, never `playlist_load_failed`.** The
  write used to sit inside the same `try` as the playlist fetch, so a browser
  refusing storage was reported as a bad playlist — the same class of mistake as
  telling a throttled host to check their URL was public, and it produced the
  same behaviour: a host swapping playlists all evening and reading the help
  page. `tests/error-messages.test.ts` pins that neither of the two browser
  codes mentions the playlist.

The boundary reports through `client_error` in `lib/analytics.ts`, bucketed by
which boundary caught it. **No message, stack or digest may join those params** —
stack frames carry pasted playlist URLs and query strings, which is exactly the
cardinality-and-user-input rule the rest of that file keeps. The digest goes to
`console.error` and onto the crash screen, where the person who can quote it
already is.

## A round's async work must not land on the next round

`lib/round-token.ts` is the rule that stops one round's pending work from
playing under the next round's card. A player reported "it was playing the wrong
audio for my playlist" and this was half the cause; the other half is the
picker, above.

The game page holds **one** `<audio>` element and one set of phase state across
every round, so anything that awaits mid-round — resolving a preview, repairing
a rotted URL — can come back after the host has pressed Skip Track, Reveal
Answer or End Game. `playClip` renders the "Skip Track" button *during* its own
await, 1500ms in, which makes a host advancing while a preview resolves the
ordinary case rather than a corner one.

- **The rule lives in `lib/`, not in the component.** Same reason
  `lib/room-poll.ts` and `lib/song-count.ts` do: the suite reaches `lib/` and
  vitest cannot import a `.tsx` module here, so a rule left in
  `app/game/page.tsx` is a rule with no test. It was written inline first, under
  a comment conceding exactly that.
- **`begin()` returns its own comparison, and that shape is the point.**
  Capture-then-compare is a two-step rule whose steps can be forgotten
  independently; handing the compare back from the capture means a caller that
  remembered one has necessarily got the other. Call it *before* the await.
- **`retireRound()` is the single round teardown, and a new round-ending path
  must go through it.** It stops the clip, bumps the token, hands the `<audio>`
  element's `src` back, and clears the loading affordances — four things whose
  ordering nothing in the suite can reach, because the guard lives in a
  component the tests cannot import. `nextTrack` and `endGame` both call
  it; a third path that forgets the bump fails silently, which is the bug this
  exists to prevent.
- **A stale answer is dropped from the round but still cached.** `previewCache`
  is keyed by track id, so a resolution that came back to the wrong round is
  still worth keeping — the host who skipped past that track may come back to
  it.
- **The phase must be re-read after the await, not only before it.** Reveal
  moves the phase without ending the round, so a guard read before the await
  cannot speak for where the host is now: without the re-check the clip starts
  under the answer card the host has just put up and tears the scoring buttons
  off screen. `playClip` has exactly one caller — the waiting-phase Play button
  — so a resolution landing in any other phase can never legitimately start a
  clip.
- **`releaseClip` uses `removeAttribute("src")`, not `src = ""`.** An empty
  string resolves against the document and leaves the element holding the page's
  own URL.

## The site notice warns before it refuses

`components/service-notice.tsx` has two states and the earlier one is the
feature. `warning` fires at `SPOTIFY_BUDGET_WARN_RATIO` of the daily ceiling
while the site still works; `blocked` is the original refusal notice. A host who
is told only at the refusal has already lost the choice the warning gives them —
load the playlist now, or pick one that is already cached.

- **The threshold is evaluated where `used` is already in hand.**
  `claimDailyBudget` has the day's count on every cold load, so the warning
  costs one conditional `set` on the crossing loads and nothing on the rest.
  `getSpotifyServiceStatus` reads the flag as one more key in the `mget` it
  already spends. Answering it by summing 24 hourly buckets in the status route
  would make the notice more expensive than the gate it reports on — the same
  reasoning `DAILY_SPENT_KEY` records, one step earlier.
- **`throttled` and `approachingLimit` are never both true.** A live refusal
  outranks the warning it grew out of: "you are about to run out" tells someone
  who already has that the site still works.
- **The two headlines must stay different sentences.** "New playlists aren't
  loading" is false during a warning, and a host who reads it walks away from a
  site that would have worked for them — strictly worse than not warning at all.
  `tests/service-notice.test.ts` pins that, and pins that dismissing
  `spotify_budget_low` does not silence the refusal that follows it.

## Analytics

`lib/analytics.ts` is the only place GA4 events are declared: one `AnalyticsEvent` union locking every event name to its param shape, and `trackEvent()`, which no-ops outside production (logging to `console.debug` instead) and when `window.gtag` is missing. Add an event by extending the union — never call `window.gtag` directly.

Two conventions worth keeping:

- **Failure params are bucketed enums, never raw error messages.** Messages come from upstream APIs and from pasted playlist URLs, so forwarding them would blow up GA4's param cardinality and could carry user input into analytics.
- **Every funnel needs a denominator.** `room_join_opened` exists so a QR code that people scan but fail to get through is distinguishable from one nobody scanned. Pure helpers that shape params (e.g. `roomJobs()`) live here rather than in the calling component, because the test suite only reaches `lib/`.

New params do not appear in GA4 reports until they are registered as custom dimensions (Admin → Custom definitions, scope **Event**), and registration is not retroactive.

### The loop counters are a second, deliberate copy

Everything about the viral loop is recorded twice: once in GA4 through `trackEvent`, and once in KV through `lib/loop-stats.ts` (written by `app/r/[surface]` and `app/api/pulse`, read by `npm run stats`). This is not redundancy to clean up.

**KV is authoritative for any decision.** GA4 is for cohorting and for questions nobody has asked yet. The two will disagree — an ad blocker kills the GA4 event and not the redirect, a spent rate-limit window drops the KV increment and not the GA4 event — and the gap between them is itself a reading of how much of this audience blocks analytics. The reason the second copy exists at all is that GA4 requires someone to go and look, and the measured rate at which that happens here is zero.

Three things in that path are easy to undo by accident:

- **The loop link must stay a real navigation to `/r/[surface]`.** Replacing it with a click handler that reports and then routes loses the click it is measuring: browsers cancel in-flight requests as a document tears down, and this fires on the click that leaves the page. That is also why it is a plain `<a>` and not `next/link` — prefetching a counting endpoint invents hits — and why `/r` is in `app/robots.ts`'s disallow list.
- **`/r/[surface]` must redirect on every branch.** Unknown segment, spent limiter, KV unavailable: the visitor still reaches `/`, and only the count is lost. The person clicking is precisely the person the loop exists to reach.
- **Counters carry a liveness marker and are held 30 days, not the 7 the cache stats use.** `mget` returns null for a key that was never written, which is indistinguishable from a genuine zero, and "the CTA does nothing" is the most important negative result available here — without the marker it would render as "no data yet" forever. The 30 days is because a report that looks a week back would otherwise expire its own oldest day. **The marker is written once per instance per UTC day, not once per metric** — its reader only asks whether the count is above zero, so every write after the first doubled the cost of the whole namespace for an answer already in KV. It is recorded as written only after the write succeeds, so one unlucky request cannot cost the day its liveness.

- **The roster poll backs off, and `pollIntervalMs` is where that lives.** A flat interval spent the same 30 commands a minute on a lobby nobody has touched as on one filling up, and the second case is the common one — 450 ticks over a room's TTL for a roster that stopped changing in minute two. Every arrival resets the ladder to `ROOM_POLL_INTERVAL_MS`, so an active room polls exactly as fast as it always did; only silence is cheap. Keep the rule in `lib/room-poll.ts`: in the component nothing can test it, and this is the rule that decides the bill.

Every surface name is declared once in `lib/loop-links.ts` and derived from there by the link, the analytics param, and the server-side validator. Hand-syncing those three fails silently: a stale validator still redirects, the counter just stops, and that arm reads as "nobody clicked it".

## Phones are the host's screen

Most games are hosted from a phone, and `app/game/page.tsx` has a phone
layout under `@media (max-width: 768px)` that treats it as a remote control:
the art is sized by the viewport's height and collapses at the reveal
(`.album-wrap.revealed`), the scoreboard is one row of chips, and Next Track
lands on screen without a scroll on a 390×844 viewport — measured, because
before it the reveal ran to 807px in a 648px area and the host scrolled every
round. `tests/mobile.test.ts` pins the rules below; each one fails with the
desktop looking fine.

- **The game column is `minmax(0, 1fr)`, never `1fr`.** A bare `1fr` is
  `minmax(auto, 1fr)`, and `auto` lets the column grow to the top bar's
  one-line contents. On a 390px phone that was 435px: End Game half a button,
  the scoreboard's numbers off screen, and `html, body { overflow: hidden }`
  meaning nothing could be scrolled into view. `.top-bar` and
  `.playlist-name` carry `min-width: 0` for the same reason.
- **No focusable field is smaller than 16px.** iOS Safari zooms the page into
  a focused input with a smaller computed font-size and does not zoom back
  out. Every field on `/`, `/quiz` and the room panels draws `.url-input`,
  `.player-input` or `.count-input` from `components/setup-chrome.tsx`; the
  join and quiz pages draw the shadcn `Input`, whose `text-base` is the same
  floor below `md`; and the game's clipboard-fallback `<textarea>` is a
  field too, because it selects itself on focus.
- **`viewportFit: "cover"` in `app/layout.tsx` is what makes
  `env(safe-area-inset-*)` non-zero.** Without it every safe-area padding on
  the site computes to 0px, silently — the quiz shell shipped a release that
  way. It also lets every page run under the landscape notch, so the side
  insets are padded once, on `body` in `app/globals.css`, outside `@layer`
  (the game page's unlayered `* { padding: 0 }` would beat a layered rule);
  a page pads for them itself only when it is `position: fixed`. `themeColor`
  there matches `public/manifest.json`; the two disagreeing is a site that
  changes colour when it is installed.
- **A refresh is round one with the scores wiped**, because the sessionStorage
  payload is the setup, not the progress. `overscroll-behavior-y: none` on
  the game page refuses Android's pull-to-refresh, which is otherwise the
  ordinary gesture for scrolling back up.
- **Every `:hover` on the setup and game surfaces sits behind
  `@media (hover: hover)`, and every control there has a `:active`.** A tap
  applies `:hover` and leaves it applied until the next tap lands elsewhere;
  the pressed state a finger sees is `:active`, and every one carries
  `transition: none` so it lands on touchstart rather than at the end of
  the base rule's ease (`tests/mobile.test.ts` checks both). The
  two sheets strip the platform's tap highlight from every `button` and `a`
  on that basis, which is why the footer, the outage notice and the install
  banner — rendered under them — carry the same pair. `.album-img` takes no
  pointer events and no touch callout — the blur is CSS, and iOS's long-press
  preview shows the file as stored.
- **`useScreenWakeLock` (`lib/wake-lock.ts`) holds the screen for the whole
  game.** A locked iPhone pauses the clip. The browser releases the lock every
  time the tab is hidden and never hands it back, so the hook re-requests on
  `visibilitychange`; every failure is silent by design.

## Styling Conventions

- Dark aesthetic: background `#111`, cards `#1a1a1a`, Spotify green `#1DB954` accents
- Fonts: Bebas Neue (display) + Outfit (body), loaded via inline `<style>` in the pages
- The setup and game pages use **inline styles and `<style>` blocks**, not Tailwind classes — match this when editing them. Tailwind + shadcn/ui (`components/ui/`: button, card, input, label) are used elsewhere.

## Types

`types/index.ts` contains only the `Track` interface — the shape stored in sessionStorage and returned by `/api/playlist`. Shared game types (`GamePayload`, `GamePlayer`, `GameMode`) live in `lib/game-session.ts`; room types and constants (`ROOM_TTL_SECONDS`, `ROOM_MAX_SUBMISSIONS`, and `ROOM_CODE_ALPHABET`, which the quiz's six-character codes share) live in `types/room.ts`; quiz wire types and caps (`QUIZ_QUESTION_COUNTS`, `QUIZ_MIN_QUESTIONS`/`QUIZ_MAX_QUESTIONS`, `QUIZ_OPTION_COUNT`, `QUIZ_MAX_ENTRIES`, `QUIZ_TTL_SECONDS`) live in `types/quiz.ts`, kept out of `lib/quiz-store.ts` for the same bundle reason; preview wire types and the two input caps (`PREVIEW_BATCH_MAX`, `PREVIEW_FIELD_MAX` with its `clampPreviewField`) live in `types/preview.ts`, kept out of `lib/preview-cache.ts` so the browser bundle doesn't pull in `lib/kv.ts` and the Upstash client; the game page defines its own local `Phase` type.

When adding a value to a union that `parseGamePayload` reads, extend that union's allow-list array alongside it (`GAME_MODES`, `PLAYLIST_SOURCES`). Both lines are guards rather than ternaries precisely so a forgotten entry is a value that reads back as the default instead of a member that silently changes behaviour.

**The same fallback is what makes retiring a value safe, and it is the only reason removing one is not a breaking change.** `mode: "trial"` and `playlistSource: "builtin"` were deleted in 1.5.0, and a game sitting in a host's sessionStorage at deploy time still had them. Because the guard falls through to `"party"` / `"own"` rather than rejecting the payload, that game keeps playing instead of failing to parse and bouncing the host to `/` mid-party. `tests/game-session.test.ts` pins it. Anything that "tightens" these guards into rejecting unknown values breaks every in-flight game on every deploy that touches a union.

## Number of Songs

`lib/song-count.ts` holds the control's whole state machine, in `lib/` rather than `app/page.tsx` because the suite only reaches `lib/`. `SongCountState` is `{count, field}` — the count is the answer, the field is what has been typed, and they are separate because a number input passes through states that are not yet a count.

**`typeCustom` rejects out-of-range input and `commitCustom` clamps it. That asymmetry is deliberate and collapsing it reintroduces a shipped bug.** Rejecting per keystroke is what stops a half-typed "150" from committing 1 and then 15. Clamping on blur is what stops the field from being left showing 99 after the host typed 999 — the last in-range prefix, a number nobody typed, from a rule nothing on screen states. One rule for both events gets one of those two wrong.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
