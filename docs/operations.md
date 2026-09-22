# Operations

Deploying, and what to do when something is wrong. `README.md` covers first-time
setup; this is the part you need at 11pm.

---

## 1. Two deploys, and only one is automatic

| | Where | How | When |
|---|---|---|---|
| The app | Vercel | auto-deploys on merge to `main` | every merge |
| The buzzer Worker | Cloudflare | `cd worker && npm run deploy` | **manually, never automatically** |

**The Worker does not deploy itself.** Nothing in CI touches it. A change to
`worker/src/` that is merged and not deployed leaves production running the
previous version, and the symptom is not an error — buzzer rooms simply behave
like the old code.

`lib/buzzer-protocol.ts` is imported by both sides. Changing it means deploying
both, and **the Worker first**: an old Worker talking to a new client fails on
messages it does not recognise, while a new Worker talking to an old client
usually still works, because the protocol only ever gains message types.

```bash
cd worker
npm run typecheck
npm test
npm run deploy
```

## 2. There is no CI

No `.github/workflows`. Nothing runs the suite before a merge. Before opening a
pull request:

```bash
npm test              # 48 files, 994 tests, ~2s
npx tsc --noEmit
npx eslint app lib components
npm run build         # see the warning below
```

> **Never run `npm run build` while `npm run dev` is running.** The production
> output overwrites `.next` and the dev server then answers every request with
> `Cannot find module ./331.js`. `rm -rf .next` is not enough — the running
> process still holds the old chunk table in memory, so the dev server has to be
> restarted. Stop dev first.

## 3. Environment variables

Full annotated list in `.env.example`. What actually breaks without each:

| Variable | Missing means |
|---|---|
| `SPOTIFY_CLIENT_ID` / `_SECRET` | no playlist loads at all — every game starts from a pasted URL, so this is total |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | falls back to an in-process `Map`. Fine for `next dev`; **broken on Vercel** — rooms created by one lambda are invisible to another, rate limits reset per instance, caches lose most of their hit rate |
| `NEXT_PUBLIC_BUZZER_WS_URL` | Buzzer Mode reports rooms unavailable rather than failing at connect time |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | no GA4. The KV loop counters still work |
| `NEXT_PUBLIC_BASE_URL` | defaults to `https://www.guessong.app` |
| `SPOTIFY_MAX_LOADS_PER_MINUTE` | defaults to 40 |
| `PREVIEW_MAX_LOOKUPS_PER_MINUTE` | defaults to 120 |

---

## 4. Reading what production is doing

### The loop

```bash
npm run stats
```

Full guide: [viral-loop.md](viral-loop.md#5-running-npm-run-stats). Every number
it prints is a floor, bar two — the quiz's `opened` and `board` are ceilings —
and §6 there explains why that matters more than it sounds.

### The caches

No endpoint, by design; an endpoint would need an auth story for what is a
two-line grep. In the Vercel logs:

```
[playlist-cache] miss id=… source=… misses=…
[preview-cache]  miss hits=… misses=… unavailable=…
```

Both log **only on a miss**, so the instrumentation gets quieter as things get
healthier and a sudden run of lines is itself the signal.

**The lines describe one request, not the day.** They used to carry a cumulative
`rate=`, which meant reading two more counters back out of KV on every miss — on
the path that is by definition already the expensive one — to compose a sentence
for a log nobody tails. The cumulative view moved to where it is actually read:

```bash
npm run stats            # the loop counters
```

…and, for the caches, `getCacheStats()` / `getPreviewCacheStats()`, which answer
on demand rather than on every miss. `misses=` in the playlist line is still the
running day total, because it is what `incr` returns and so costs nothing.

Two traps in reading those lines, both of which have cost a debugging detour:

- **Trust `source=`, not the log row's method.** Only `POST /api/playlist`,
  `POST /api/room/[code]/submit` and `POST /api/quiz` can emit the line
  (`source=playlist-api`, `room-submit`, `quiz-create`), but Vercel attributes
  it to whichever request the instance happened to be serving, so it frequently
  appears against an unrelated `GET`.
- **A replayed 404 counts as a hit** in `getCacheStats()`. Correctly — it
  answered without touching Spotify — so a host retrying a dead link pushes the
  rate *up*. `negativeHits` is that subset; `hits - negativeHits` is the part
  describing real playlists. The bucket is a **UTC** day, so a rate read just
  after 00:00 UTC is measuring almost nothing.

---

## 5. Symptoms

### "Every route returns 500 with an empty body"

Check the Upstash request quota first. The free plan allows 500,000 commands a
month, and once it is spent **every** Redis command fails with
`ERR max requests limit exceeded` until the quota rolls over — days, not the
seconds a network blip costs.

The signature is a `500` with `content-length: 0` and no `code` in the body,
on every route at once including `/api/playlist` and `/api/preview`, while `/`
and `/quiz` still serve `200` because the static pages touch no KV:

```
curl -i -X POST https://www.guessong.app/api/playlist \
  -H 'Content-Type: application/json' -d '{"url":"<any public playlist>"}'
```

An empty body is the tell. Every handled failure in this app answers with
`{error, code}` — see `lib/api-error.ts` — so a response with neither did not
come from a handler at all. What the host sees is the generic "couldn't load
the playlist", which points at their URL and is actively misleading: the
playlist is usually fine, and they will re-copy the link and retry instead of
reporting an outage.

This used to be a total outage rather than a degradation, because
`enforceRateLimit` runs at the top of every API route *before* its own
`try`/`catch`, and `lib/rate-limit.ts` was the one KV consumer that did not
fail open. It does now, so an exhausted quota costs the per-IP ceiling and the
KV-backed features instead of the site. What still degrades while the quota is
spent:

- **Rooms and Mixed Playlist Mode stop**, cleanly — `room_open_failed` rather
  than a bare 500. They *are* the KV, so there is nothing to fall back to.
- **Taste Quiz stops too**, for the same reason: creating a link, opening one,
  answering and the board all read the one hash in KV, and each answers its
  own code (`quiz_create_failed`, `quiz_load_failed`, …) rather than a bare
  500. A link sent before the outage shows "Couldn't load the quiz." until
  Upstash is back, and its seven-day TTL keeps counting down meanwhile. A
  quiz already mid-play degrades rather than stalling: the per-question check
  fails soft — the question advances with no verdict ("Answered — it counts
  at the end") and GA4's `quiz_check_lost` is the only record. The link's
  card falls back to the generic quiz card, held a minute at the edge rather
  than a day, so it recovers with KV.
- **Every cache misses**, so each playlist load reaches Spotify and each track
  reaches iTunes/Deezer. The site works and is slower.
- **The global budgets and the 429 cooldown are gone too**, since they are KV
  counters that also fail open. This is the accepted trade — losing the safety
  net means "back to how it was", not "nobody can play" — but it does mean the
  shared Spotify quota is running unprotected. Restore Upstash before assuming
  a Spotify 429 is a separate incident.
- **The loop counters stop**, so `npm run stats` under-reports that window.
  The liveness marker (see `docs/viral-loop.md`) is what keeps this readable as
  a gap rather than a genuine zero.

Sustained command volume is worth a look before raising the plan, and the room
panel's roster poll is the first place to look, because it was how this quota
was spent. `/api/room/[code]/status` runs every 4s and costs two commands a
tick — the route's rate-limit `incr`, then the room read. It used to be a bare
`setInterval` bounded only by the panel staying mounted, so a host who opened a
room and left the tab parked kept polling at ~15 requests a minute forever,
against rooms that `ROOM_TTL_SECONDS` had already deleted; the 404s were
swallowed and retried. That is ~43k commands a day per abandoned tab, on a
budget of 500k a *month*, buying nothing.

`components/room-panel.tsx` now stops on all three: a terminal status (404
gone, 410 already started), a deadline of `ROOM_TTL_SECONDS` from mount, and a
hidden tab (which skips the fetch and polls once on return). If that loop is
ever refactored back toward `setInterval`, all three have to survive it — none
of them is visible in the UI, and the cost of losing them shows up weeks later
as this symptom.

### "Songs have no audio"

First distinguish the two causes, because they call for opposite responses:

- `absent` — nothing anywhere has a clip for that recording. A catalogue gap.
  Curate around it.
- `unavailable` — **our** problem: throttled, out of budget, or the request did
  not get through.

`preview_miss` in GA4 carries this as a bucketed `reason`, and
`[preview-cache] … unavailable=` rising while `misses=` stays flat is the
throttling signature. Reading the second as the first is how a previous
investigation went hunting for songs that were never missing.

Note that iTunes signals throttling with **403**, not 429, and Deezer returns
its quota error in the body of a **200**.

### "Vercel says the CPU budget is nearly spent"

Fluid Compute bills **Active CPU** — time your code actually runs. Waiting on
Spotify, iTunes or Upstash is free, so the bill is not a story about slow
upstreams. It is a story about how many function invocations happen at all, and
how expensive each one is. Hobby is 4 CPU-hours a month; going over does not
cost money, it suspends the project until you deal with it.

Do not reason about this from the code. Get the distribution first:

```bash
vercel logs <production-deployment-url> --json > /tmp/logs.jsonl
```

Then count by `source` and `requestPath`. Only `source: "serverless"` and
`source: "edge-function"` are billed; `source: "static"` is served from the CDN
and costs nothing. That one command is what turned a guess into an answer here —
the two things that had been quietly dominating the bill were:

- **Routes that should have been static and were not.** A page or route handler
  carrying `export const runtime = "edge"` is opted out of static generation, so
  it runs per request. Next prints a warning at build time and it is easy to
  read past. The reliable check is the route table from `npm run build`: `○` and
  `●` cost nothing, `ƒ` runs every time. Three image routes were `ƒ` for months
  and nothing on the page looked wrong, because the bytes are identical either
  way. One `ƒ` image route is deliberate since 1.11.0:
  `/q/[code]/opengraph-image`, the per-quiz chat card, which cannot be built
  ahead because the owner's name is in KV. What bounds it is its own
  `s-maxage` header (one render per quiz per region per day at the edge) and
  the `quiz:card` limiter, not static generation — CLAUDE.md's "SEO /
  Metadata" has the rule. Do not "fix" it back to `○`; in the logs a
  `cache: MISS` on it should be rare, not absent.
- **A client retrying something that can never succeed.** A cached 404 answers
  in ~100ms, which is faster than a button re-enables, so a host tapping Start on
  a dead playlist generated bursts of fourteen billed invocations that all
  replayed the same cached refusal. Per-IP rate limiting does not catch this —
  the bursts sit well inside the allowance. See CLAUDE.md's
  `isDeterministicPlaylistFailure` note for why only some failures may be
  written off this way.

The general shape: an expensive-looking route with a good cache is usually fine,
and a cheap route invoked in a loop is usually the problem.

### "Spotify says 429"

The cooldown in `lib/playlist-cache.ts` parks all *uncached* loads for the
`Retry-After` duration (clamped 30s–24h — `QUOTA_EXCEEDED` carries a value in
the tens of thousands of seconds), shared across instances via KV. The key's
own TTL is `COOLDOWN_PROBE_SECONDS` (15 min), so the gate re-probes on schedule
and a refused probe rewrites the cooldown from a fresh header. Cached playlists
keep serving throughout, so a party already mid-game is unaffected.

If it is persistent rather than a spike, lower `SPOTIFY_MAX_LOADS_PER_MINUTE`.
Its default of 40 is a guess — the right value depends on which quota tier the
Spotify app is on, which the code cannot discover, which is why it is an env
var. Watch the hit-rate log for a week and tune.

**Never flatten an upstream 429 into a generic 400.** The client has to be able
to tell "your playlist is wrong" from "we are throttled"; an earlier version
told throttled hosts to check their URL was public, which sent them straight
back into retrying against a spent quota.

### "The buzzer room will not connect"

In order of likelihood:

1. `NEXT_PUBLIC_BUZZER_WS_URL` unset or pointing at a dead Worker
2. The Worker was not deployed after a merge (see §1)
3. The room expired — the DO has a **3h idle timeout**, and it slides on host
   activity

A room that does not exist is refused at the WebSocket upgrade, which means the
client can never receive an app-level error — there is no socket to send one
over. `lib/use-buzzer-socket.ts` therefore counts consecutive never-opened
attempts and gives up at three. The threshold cannot be one: a phone waking on a
flaky network legitimately fails the first attempt or two.

### "The host opened the room and nobody joined"

The room opens, the QR renders, every player who scans it taps Join Room and
lands on **"The game stopped"**; the host's screen keeps reading "Nobody has
scanned yet". Seen only on phones that have not had a browser update since early
2024 — an iPhone 8 or X on iOS 16, Samsung Internet below 27, an Android
WebView below 125 inside LINE — and never on the developer's machine.

The cause was the scheme. Production's `NEXT_PUBLIC_BUZZER_WS_URL` is
`https://guesssong-buzzer.<subdomain>.workers.dev`, not the `wss://` the docs
name. Browsers newer than the ones above fold `https` into `wss` inside the
`WebSocket` constructor themselves, so the join worked from every machine it was
tested on; older ones throw `SyntaxError: The URL's scheme must be either 'ws'
or 'wss'` from the constructor, inside the connect effect, and the route error
boundary turns that into the crash screen. `socketUrl()` in
`lib/use-buzzer-socket.ts` now folds the scheme itself, and `httpOrigin()` in
`lib/buzzer-client.ts` folds the other way with the same anchored,
case-insensitive rule; both read the value through one trimmed
`buzzerWorkerUrl()`, so either spelling of the env var works on every browser
that has a `WebSocket` at all.
`tests/buzzer.test.ts` pins it against the production value. Do not "tidy" the
env var to `wss://` as the fix and drop the fold: the next deploy that sets it
the other way brings this back for the same phones, silently.

### "I can't start the game, it always gives an error and asks me to restart"

The host switches Buzzer Mode on (or picks Mixed·QR) and the whole setup page
becomes **"The game stopped"** with a "Start over" button; pressing it reloads
the form and the next attempt does the same. A buzzer game that did reach
`/game` dies there instead, and a player landing on `/buzz/<code>` never sees
the Join form. Party mode is untouched, which is why the funnel in
`npm run stats` looks healthy while the report says "always".

Three causes, same shape, same screens, all only on someone else's phone:

- **No `crypto.randomUUID`.** Safari and iOS before 15.4, Chrome before 92,
  Firefox before 95, Samsung Internet before 16 — 2021 to 2022 — and every
  WebView on those engines. `getPersistentPlayerId()` called it unguarded,
  inside the `useMemo` that runs on `useBuzzerSocket`'s first render, so the
  `TypeError` reached `app/error.tsx` before anything else on the page ran.
  `mintPlayerId()` in `lib/use-buzzer-socket.ts` now falls back to a v4 UUID
  built from `getRandomValues` (every engine since 2012), and below that to a
  `Math.random` v4 shape, so the Worker is handed the same-shaped identity
  either way.
- **`localStorage` that throws on the property access.** Safari with "Block
  All Cookies", some embedded webviews. The same function, the room panel's
  mount effect and the join page's mount effect all read it raw; the
  `withStorage` guard in `lib/host-session.ts` existed for exactly this and
  they did not use it. They do now, through `readStored` / `writeStored` /
  `removeStored`; on such a device the seat lasts the page rather than the
  device, and the game plays. A reload on that phone is a new player id, so
  the Worker now hands a seat whose owner has no socket to a join under the
  same name — queue place and, on the host's screen, score included — instead
  of refusing it as taken until the idle alarm (`takeSeat` in
  `worker/src/buzzer-room.ts`). Three rules keep that from being a way to
  steal a seat: a name whose owner *is* connected is still refused; the seat
  remembers the id that opened it (`adoptedFrom`), and that id takes the seat
  back whenever it returns, the taker being told the name is taken — so two
  Alexes at one party sort themselves out in favour of the phone that was
  there first; and the host's seat (`hostPlayerId`) is taken by nothing but a
  join carrying the token, which in turn takes it from anyone and leaves no
  opener behind — the host's socket closes on the `/` → `/game` navigation,
  a guest who joined as "Host" in that gap used to lock the token holder out
  of their own room, and a reclaim that outranked the host's seat brought
  that back one reconnect later as an eviction ping-pong. A takeover that
  re-keys a queued buzz replays the whole queue to the room, because the
  host's screen advances its queue by matching the promoted entry.
  On a Mixed·QR room the lost "already submitted" flag makes the re-submit
  hit the mailbox's 409 `room_name_taken`; the join page carries on to the
  buzzer as on the 410 it already tolerated — the playlist is in the pool —
  counts it as `room_submission_failed:already_in`, and writes nothing, so a
  genuine second Ann who is then refused at the socket gets the form back
  with her playlist still in it. **Both halves ship together: the Worker
  deploy is manual (§1), and a Next deploy without it leaves the reload
  refused as before.**
- **A Worker URL the page may not open.** The third throw on the same path:
  `new WebSocket(url)` refuses a `ws://` URL from an https page synchronously
  (mixed content), and an unparseable value the same way. `socketUrl()` now
  upgrades `ws://` to `wss://` on an https page, and the constructor sits in a
  `try` whose catch reports `unreachable` — one of the three codes the page
  mints for itself (`BUZZER_CLIENT_ERROR_CODES`; `no_answer` is a room that
  never answered three times running, with a Try again that opens a clean
  socket), with the operator's half (`NEXT_PUBLIC_BUZZER_WS_URL`) on the
  console. Both host panels — the room panel on `/` and the game's — render
  the hook's error at all now, through `buzzerErrorMessage(…, "host")`,
  because the player's sentence for an ended room tells the host to ask the
  host.

Reproduce any of them on a laptop without an old phone: headless Chrome with a
`Page.addScriptToEvaluateOnNewDocument` of `delete Crypto.prototype.randomUUID`
(and/or a throwing `localStorage` getter), then open `/game` with a buzzer
payload in `sessionStorage`. `tests/buzzer.test.ts` pins the fallback chain and
the storage degradation. With the socket URL's scheme above, that is three
unguarded browser calls in that file in a week: the rule is that nothing in the
buzzer client may hand the browser a call it might not have, or trust storage
to be there, without a fallback.

### "The room disappeared mid-game"

Mixed Playlist rooms use `ROOM_TTL_SECONDS = 30 * 60`, counted from **creation**
and deliberately not extended by activity (`types/room.ts`, `lib/room.ts`). That
is correct for a one-shot playlist mailbox and wrong for anything that must
outlive a full game. Buzzer rooms are a different system with a sliding timeout.

### "The quiz link says it doesn't exist any more"

A quiz is one Redis hash, `quiz:v1:<CODE>`, with `QUIZ_TTL_SECONDS` = 7 days
counted from **creation** and never extended (`types/quiz.ts`,
`lib/quiz-store.ts`) — the same shape as a Mixed Playlist room, one size up.
After that the link 404s with `quiz_not_found` and the only fix is a new quiz.
If the code is nowhere near that old, check the Upstash quota (above): a KV
that is refusing commands answers `quiz_load_failed` instead, which the phone
renders as "Couldn't load the quiz." rather than "doesn't exist any more".

### "Only whoever made this quiz can see its results page"

Expected on every device except the one the quiz was made on. The host token
lives in that device's `localStorage` (`guesssong_quiz_tokens`, the ten most
recent, `lib/quiz-session.ts`) and nowhere else — there is no account to sync
it to. The public ranking on `/q/<code>` is the fallback; the board is gated
because its per-question rows are the answer key, so do not make it public.

### "An old quiz link opens the party form"

The quiz has its own page since 1.12.0 (`/quiz`, static). Two spellings
predate it and are still in group chats and cached pages: `/?mode=quiz` (the
content pages' link) and `/?ref=quiz_result` (the loop's warm arm). Both are
redirected to `/quiz` by `redirects()` in `next.config.js`, in Vercel's routing
layer before any HTML is served, and the query rides along so the loop ref
survives the hop. `app/page.tsx` keeps a mount-effect fallback
(`requestedSetupMode` → `quizArrivalHref`, `lib/setup-arrival.ts`) that does
the same one full page load later. So if the party form is what loads, the
config entry is gone — `tests/next-config.test.ts` pins both rules — and if it
flashes and then goes to `/quiz`, only the fallback is running. In GA4 the
same defect reads as `quiz_created.arrived_from = "quiz_result"` dropping while
`click:quiz_result` in `npm run stats` holds.

### "The quiz offered a song that is in my playlist as the wrong answer"

Reported in those words and fixed in 1.12.1: the exclusion compared titles
folded for case and whitespace only, and Spotify spells the same song
differently from `lib/quiz-decoys.ts` (Simplified for a mainland act, a
full-width bracket on a qualifier, K-pop in English). Both sides now go through
`titleKey` (`lib/quiz.ts`), a pool entry excludes under its `aka` titles too,
and `tests/quiz.test.ts` drives the production pool against fourteen of
Spotify's own spellings. Two causes remain, told apart by the playlist's size:

- **Over 500 tracks:** `loadPlaylist` samples anything past
  `MAX_PLAYLIST_TRACKS` (`lib/spotify.ts`), so the quiz excludes the sample's
  titles, not the playlist's. Known, unfixed; only a shorter playlist avoids it.
- **Under 500:** a pool title Spotify never uses. Search the track
  (`GET /v1/search?type=track`), make the entry's `name` the spelling Spotify
  returns, move the old one to `aka`, and add the pair to that test. Not by
  editing `lib/cjk-fold.ts`, which is generated.

### "The game runs off the right edge of my phone"

Fixed in 1.13.0, and worth knowing the shape of because it never reproduces on
a laptop. `.game-layout`'s column was a bare `1fr`, which is `minmax(auto, 1fr)`,
and `auto` let the column grow to the top bar's one-line contents — round badge,
playlist name, End Game. On a 390px phone that came to 435px, and
`html, body { overflow: hidden }` meant nothing could be scrolled into view: End
Game was half a button and the scoreboard's numbers were off screen. The column
is `minmax(0, 1fr)` now, with `min-width: 0` on `.top-bar` and `.playlist-name`
so a long name ellipsizes instead of widening the row (`app/game/page.tsx`);
`tests/mobile.test.ts` pins all three, and a long playlist name is the quickest
reproduction if it ever comes back.

Two phone-only symptoms that shipped alongside it are told apart by what the
host describes. **The page zooms in on the first tap and stays zoomed:** a
focusable field under 16px — iOS Safari zooms into it and never zooms back out.
The floor lives in `components/setup-chrome.tsx`, and the game's
clipboard-fallback `<textarea>` counts as a field because it selects itself on
focus. **The layout sits under the notch in landscape, or a safe-area padding
computes to 0px:** `viewportFit: "cover"` is missing from `app/layout.tsx`; it
is the only thing that makes `env(safe-area-inset-*)` non-zero, and the quiz
shell padded by the insets for a whole release before that was noticed. The
side insets are padded once, on `body` in `app/globals.css`, so a page that adds
them again doubles them.

Reproduce on a 390×844 viewport (headless Chrome, or a real phone via
`DEV_ORIGINS`), not by narrowing a desktop window: desktop Chrome does not zoom
into inputs and has no insets, which is how all three shipped. The rules, and
why each fails with the desktop looking fine, are in CLAUDE.md under "Phones
are the host's screen".

### "The phone locked mid-clip and the music stopped"

Since 1.13.0 the game page holds a screen wake lock for the whole game, final
scores included (`useScreenWakeLock` in `lib/wake-lock.ts`, mounted from
`app/game/page.tsx`), so on a browser that grants one the phone stays awake
through a long guess. Every refusal is silent by design: the API is absent on
older browsers, refused on low battery, and blocked inside some webviews, and
in each case the game plays exactly as it did before the hook existed — the
host's fix is the phone's own auto-lock setting. `'wakeLock' in navigator` from
the console on that phone is the whole diagnostic; there is nothing to log
because there is nothing to act on.

One case the hook does not cover, and it is a known gap rather than a bug: a
lock the platform drops while the page stays visible is not re-requested until
the tab is next hidden and shown, because the hook listens to `visibilitychange`
and not to the sentinel's `release` event. A `release` listener that re-asks
needs a backoff or it loops under battery saver — add that before adding the
listener. `tests/wake-lock.test.ts` drives every branch the hook does have.

### "A clip plays but the answer card disagrees"

Two causes, and they are told apart by whether it is reproducible. Ask the host
whether they skipped or revealed while it said "Finding audio…".

**If it only happened once, on a round they advanced past:** the preview
resolved after the host had moved on and landed on the round in front of it.
`lib/round-token.ts` stamps a generation before every await and
`retireRound()` bumps it, so this is fixed as of 1.7.5 — but a round-ending
path added later that forgets to call `retireRound()` brings it straight back,
and nothing in the suite can catch that (the guard lives in
`app/game/page.tsx`, which vitest cannot import). Check the call sites first.

**If the same track is wrong every time:** a wrong recording was cached as
correct. Positive preview entries are held a **year**, and `&refresh=1` repairs
rotted URLs, not wrong songs — worse, a wrong-but-playable URL never fires the
`<audio>` error that triggers refresh at all. The matching rules are in
`lib/preview-cache.ts`; the 1.2.0 changelog entry has the original tier
reasoning and 1.7.5 has the three corrections layered on it (credits compared as
acts, a qualifier-stripped title tier, artist-less lookups held to the running
time). Fixing one means invalidating that track's key, not bumping the cache
version: a version bump cold-starts every entry in production simultaneously,
which is the upstream stampede the module exists to prevent.

---

## 6. Release

Both changelogs, always. `tests/changelog.test.ts` fails if `package.json`'s
version moves without a matching entry in `lib/changelog.ts`.

1. `CHANGELOG.md` — the maintainer's record. Technical, names files and
   functions, carries a "Known gaps" list.
2. `lib/changelog.ts` — what players read in the footer overlay. Plain language
   and **bilingual**: every entry needs `text`/`textZh` and
   `headline`/`headlineZh`. `/zh` is written natively, so an English string
   leaking through is a visible defect.
3. `package.json` version.

Purely internal changes — a script, a doc, a refactor with no user-visible
effect — take no version bump and no `lib/changelog.ts` entry.
