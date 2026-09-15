# The viral loop

Shipped in 1.3.0. How it works, and — the longer half — how to read what it
measures without drawing the wrong conclusion.

---

## 1. The gap it closes

Buzzer Mode had been putting a phone in every hand for weeks and never told any
of them what they were holding:

- `app/buzz/[code]/page.tsx` — 264 lines, zero `<a>` tags, and not one
  occurrence of the string "GuessSong"
- `app/j/[code]/page.tsx` — ended at a confirmation card with nowhere to go
- `lib/result-image.ts` — printed "Played with GuessSong" on the one artifact
  that leaves the party, with no address on it

Every party put four or five phones on those pages, and the product never spoke
to any of them. The expensive half of a loop — rooms, live sockets, canvas share
cards — had already shipped. This is the cheap half nobody had written.

---

## 2. The seven surfaces

Each is declared **once** in `lib/loop-links.ts` and derived from there by the
link, the analytics param, and the server-side validator. The order below is the
order of that declaration, which reads down the funnel: the two passive footers,
the two moments a player has just finished doing something, then the two QR
codes, and last the one surface whose carrier is a URL rather than a QR.

| Surface | Where | When |
|---|---|---|
| `buzz_footer` | buzzer page, all three return paths (`app/buzz/[code]/page.tsx:210`, `:243`) | always, including the pre-join form |
| `buzz_cta` | buzzer page, full-width button (`app/buzz/[code]/page.tsx:289`) | between rounds, after the first resolves |
| `join_footer` | Mixed Playlist submit page (`app/j/[code]/page.tsx:146`) | always |
| `join_submitted` | Mixed Playlist confirmation screen (`app/j/[code]/page.tsx:103`) | after a playlist is submitted |
| `game_over` | QR on the host's Game Over screen (`app/game/page.tsx`, `<LoopQr />`) | party mode, end of game |
| `share` | QR drawn into the result card image (`lib/result-image.ts`'s `drawCardFooter`) | wherever the picture ends up |
| `quiz_result` | the result screen of a Taste Quiz (`app/q/[code]/quiz-client.tsx:1295`, `<LoopCtaButton surface="quiz_result">`) | after a taker has submitted their answers |

`quiz_result` (1.9.0) is the first surface reached by tapping a URL in a group
chat rather than by scanning a QR off a screen or out of an image. It is kept
apart from `share` even though both leave the party: `share` had converted 0 of
50 when the quiz was built, and the question the quiz exists to answer is
whether that was the audience or the carrier. Merging the two rows would bury
the answer — [decisions.md D9](decisions.md#d9--the-quiz-is-a-loop-surface-not-a-game-mode).

### Why one declaration

The name is needed in three places at once, and hand-syncing them fails
*silently*. A renamed `href` against a stale validator still redirects — the
counter simply stops incrementing, and that arm reads as "nobody clicked it".
You would then correctly conclude the call to action was useless and delete one
that was working. Same single-union trick `lib/buzzer-protocol.ts` uses across
the Worker boundary.

Since 1.12.0 the *copy* is declared beside the names, for the same reason:
`LOOP_CTA_LABEL` (the button), `LOOP_FOOTER_LABEL` ("Made with GuessSong — host
your own") and `LOOP_QR_CAPTION` replaced seven phrasings across seven files.
The quiz result keeps its own line, `makeYourOwn` in `lib/quiz-copy.ts`, because
it is read in two languages and lands somewhere else (below).

### The buzz CTA gate

`snapshot.phase === "idle" && snapshot.roundIndex >= 1`.

Two things about that are easy to get wrong:

- **Not a `locked → idle` transition.** `handleResolve` in
  `worker/src/buzzer-room.ts` reaches `idle` from both `open` and `locked`, so a
  round nobody buzzed at is indistinguishable from one that was answered.
  `roundIndex` advances only on `host:next`, which is exactly "a round
  finished".
- **Read off the snapshot, not a component ref.** A reconnect adopts the whole
  snapshot by design, so a ref would reset and the button would vanish for the
  rest of the game.

It stays mounted and hidden rather than unmounting, so appearing between rounds
cannot shove the buzz button down the screen under someone's thumb.

---

## 3. How a click is counted

```
  player taps ──▶ GET /r/buzz_cta ──▶ 302 to /?ref=buzz_cta ──▶ app/page.tsx
                        │                                            │
                        │ KV: click:buzz_cta ++                      │ remembers
                        │                                            │ the ref for
                        ▼                                            │ 60 days
                  lib/loop-redirect.ts                               │
                  decides; the route is a shell                      ▼
                                                          later: game_started
                                                          carries arrived_from
```

**The link is a real navigation, not a click handler.** The click being measured
is the click that leaves the page, and browsers cancel in-flight requests as a
document tears down — so a background report fired at that moment is the report
most likely to be lost, silently, in exactly the cases worth measuring. Routing
through the server makes the navigation itself the measurement. There is nothing
left to cancel.

Consequences worth not undoing:

- Plain `<a>`, never `next/link`. Prefetching a counting endpoint invents hits.
- `Cache-Control: no-store`, or an intermediary caches the 302 and later clicks
  from that network never reach the counter — the redirect keeps working while
  the measurement stops.
- `/r` is in `app/robots.ts`'s disallow list, for the same reason.

**Every branch still redirects.** Unknown segment, spent rate limit, KV
unavailable: the visitor reaches the setup page regardless, and only the count
is lost. The person clicking is precisely the person this feature exists to
reach.

**The quiz arm lands on `/quiz`, not `/`.** `handleLoopHit` sends a
`quiz_result` click to `/quiz?ref=quiz_result` (`isQuizSurface` in
`lib/setup-arrival.ts`), because the person was just promised "make your own"
and the party form is not that; every other arm still lands on `/`. The quiz
page remembers the ref the same way `/` does (`rememberLoopRef`, 60 days), so
the conversion to read for this arm is `quiz_created.arrived_from` — a
`game_started` carrying `quiz_result` is the same person weeks later. Before
1.12.0 the redirect went to `/?ref=quiz_result` and `app/page.tsx` opened its
form on the quiz pill — the party page doing two jobs, which is what `/quiz`
ends. The old spelling is redirected by `next.config.js` (see
[operations.md](operations.md#an-old-quiz-link-opens-the-party-form)).

### Attribution is delayed on purpose

`arrived_from` is credited to the **last loop touch within 60 days**, not to the
visit that carried the `?ref=`. The conversion is not same-session: somebody
taps a call to action on a friend's sofa and hosts their own party a fortnight
later. Crediting only within the pageview would record almost every real
conversion as organic and report a working loop as dead.

---

## 4. Counted twice, on purpose

| | GA4 | KV (`lib/loop-stats.ts`) |
|---|---|---|
| Read by | a human, in a browser | `npm run stats` |
| Good for | cohorts, sessions, unasked questions | decisions |
| Dies to | ad blockers | a spent rate-limit window |

**KV is authoritative for any decision.** The reason the second copy exists is
that GA4 requires someone to go and look, and the measured rate at which that
happened here was zero across four attempts over eight weeks — during which
every feature decision was made on an n of 1.

The two will disagree, and the gap is itself a reading: it is roughly how much
of this audience blocks analytics.

---

## 5. Running `npm run stats`

```bash
npm run stats           # last 7 UTC days
npm run stats -- 30     # last 30 (the cap — counters have a 30-day TTL)
```

No setup needed. The script reads `.env.local` and `.env` (both gitignored) via
Node's built-in `process.loadEnvFile`, the same files `next dev` reads.
Precedence matches Next: **shell export > `.env.local` > `.env`**, so pointing
at another database is a prefix away:

```bash
UPSTASH_REDIS_REST_URL=https://other-db.upstash.io npm run stats
```

> The load order in the script is *inverted* (`.env.local` first) because
> `loadEnvFile` does not overwrite a variable that is already set — first writer
> wins. Remember that if you touch it.

These are production values, from the Vercel project's environment variables.
Without them there is nothing to read: `lib/kv.ts` falls back to an in-process
`Map`, so a local run has no data. The script says where it looked and exits 1
rather than printing a misleading empty table.

### Output

```
GuessSong loop — last 7 days (UTC)
Days with any activity: 2/7

Surface            shown    followed     rate
────────────────────────────────────────────────
buzz_cta            136          14    10.3%
buzz_footer         120           4     3.3%
game_over            22           9    40.9%
join_footer          44           2     4.5%
join_submitted       31           7    22.6%
share                14           1     7.1%
quiz_result          19           3    15.8%

Games started       33
Repeat hosts        4    12.1% of games

Games by host's game number
   1     21  █████████████████████████
   2      3  ████
  10+     1  █

Playlist quiz — the link-shaped surface
  created         12   en 4 · zh 8
  opened          31   2.6 per quiz
  started         24    77.4% of opens answered a question
  completed       19    61.3% of opens ·  79.2% of starts
  board            7    58.3% of quizzes had the owner back for results
    acquaintance     7  ██████████████████████████████
    close            6  ██████████████████████████
    guessing         3  █████████████
    soulmate         2  █████████
    stranger         1  ████

  questions   quizzes  finishers  per quiz
    10 preset      3          9       3.0
    20 default     6          8       1.3
    35 typed       1          0       0.0
    50 preset      2          2       1.0
  2 of 12 quizzes were built shorter than the host asked for — the playlist had fewer usable tracks, and the panel does not say so

  hints       heard 21 · no clip 3 · unavailable 2 · repaired 1
              1.1 heard per completed quiz, against an allowance of 2.1

  ⚠  refused by the limiter: answer 1. Each is a request the funnel above
     never saw — an answer refused is a friend who finished and was
     turned away, which reads as a low completion rate.
  the CTA on the result screen is the quiz_result row above
```

(The length, hint and refusal blocks print only once they have something to
say; a fresh deploy shows the five stages and the verdicts alone.)

| Field | Meaning |
|---|---|
| `Days with any activity` | days that recorded anything. **Read this first** |
| `shown` | the surface was rendered, once per surface per tab. `share` is the exception — see below |
| `followed` | someone clicked and the server saw it |
| `rate` | `followed ÷ shown` |
| `Games started` | real hosted parties — only the paths that call `recordHostedStart` |
| `Repeat hosts` | games at index ≥ 2. **The number this work is waiting on** |
| `created` / `opened` / `started` / `completed` / `board` | the Taste Quiz funnel (`recordQuizStage` in `lib/loop-stats.ts`), bumped by the route that did the thing — `POST /api/quiz`, `GET /api/quiz/[code]`, `POST /api/quiz/[code]/check` with `q=0`, `POST /api/quiz/[code]/answer`, `GET /api/quiz/[code]/board` — not beaconed from a page, so nothing here is lost to a tab closing. The block is printed only once something has been recorded |
| `en 4 · zh 8` | the language each quiz was made in (`quiz_locale:<l>`, the `locale` the quiz page (`/quiz`) sends). Which audience the bilingual panel is reaching — the share sentence and the friend's page render in this language |
| `per quiz` | `opened ÷ created`. Below 1 means quizzes are being made and not sent — a share-step problem, not a quiz problem |
| `started` / `answered a question` | the first question's check — the first half tapped, once per attempt, since an answered question is locked. `started ÷ opened` is the intro card: a friend who read it and left. **Dated**: it began with the per-question reveal (1.11.0), so a window straddling that deploy reads low against opens |
| `of opens` | `completed ÷ opened`, the whole taker side. **`opened` is a ceiling, not a floor — see §6** |
| `of starts` | `completed ÷ started`, the quiz itself. This, not `of opens`, is the number to read against the length table — but it is a **ceiling on finishing, not a floor**: `completed` is bumped on every replay ("See my result again", and a resend after a lost response) while `started` is bumped once per attempt, so one taker who reopens their result three times is 3 over 1, and the ratio can read above 100%. Read the direction, not the figure |
| `board` | the owner opened their results page *with the token* — a guessed URL lands on 403 and is not counted. `board ÷ created` is the owner's half of the loop: a quiz whose board is never opened was sent and forgotten. **Also a ceiling** — the page fetches on every mount |
| the verdict bars | how completed quizzes came out (`quiz_verdict:<bucket>`, from `verdictFor` in `lib/quiz.ts`): `soulmate` ≥ 90%, `close` ≥ 75%, `acquaintance` ≥ 60%, `guessing` ≥ 50% (the band a coin lands in), `stranger` below chance. The difficulty gauge — see §7 |
| the `questions` table | one row per length that had a quiz made or finished (`quiz_len:created:<n>` / `quiz_len:completed:<n>`). `quizzes` is what hosts chose, tagged `default` / `preset` / `typed` so the typed field's use is visible; `finishers` is answer sheets graded for quizzes of that length; `per quiz` is `finishers ÷ quizzes` — two floors over each other, so unlike `of opens` it needs no ceiling. A row with finishers and no quizzes is a quiz made before the window and finished inside it |
| `built shorter than the host asked for` | `quiz_clamped`: the playlist had fewer usable tracks than the requested count, so `createQuiz` shortened it. The panel shows the count it got and says nothing about the one asked for — this is the only record that anyone wanted more |
| the `hints` line | the quiz's only per-question upstream path (`quiz_hint:<status>`, from `GET /api/quiz/[code]/hint`). `heard` is a clip served; `no clip` is a recording nothing has a clip for (a cached fact, free); `unavailable` is *us* — throttled or out of budget, and the page refunds the hint; `repaired` is a `refresh=1` re-resolve of a rotted URL. The second line is `heard ÷ completed` beside the mean allowance (`hintAllowance`, one per ten questions) of the quizzes that were finished |
| `refused by the limiter` | `quiz_throttled:<route>`: requests a quiz route's own `enforceRateLimit` turned away, per route. Printed only when non-zero. **Exact**, not a floor — the limiter said no, so KV was up |

---

## 6. Every figure here is a floor

This is the section that matters. **The failure mode is reading a low number as
"the call to action does not work" when it means "we could not see that it
did".**

- **Repeat hosts are systematically undercounted.** The count lives in
  `localStorage`, and iOS clears script-writable storage after seven days
  without a visit — precisely the gap between two parties. Private windows start
  empty. A laptop passed around a room is several hosts wearing one identity.
  Only the direction of this number over time means anything.
- **`followed` misses clicks that never reached the server.** Throttled ones are
  reported separately; a dropped connection is invisible.
- **`share` is the weakest arm, and its `shown` counts something else.** It
  needs someone to scan a QR out of a forwarded image — the only surface whose
  hit does not start on a page of ours. There is no element to render, so its
  impression is fired by `recordCardImpression` in `app/game/page.tsx` when a
  card is actually saved (`shared` or `downloaded`; a dismissed share sheet
  leaves no image and so no QR in the world). The unit is therefore **a party
  that produced at least one card**, not a card — the per-tab dedup means saving
  both the scores card and the taste card counts once. Its `followed` can also
  arrive weeks later from a device that has never seen this site, so numerator
  and denominator are not the same population and the `rate` is a spread
  indicator, not a conversion.
- **`organic` is a catch-all** for every lost attribution: a PWA launched from
  the home screen, a stripped query string, a retyped bare domain. Organic is
  already nearly all traffic, so the loop's share of starts is a floor.
- **`opened` and `board` are the two figures here that are ceilings.** Each
  is bumped on every successful fetch, and both pages fetch on every mount,
  reload and Retry, so one friend opening the link twice is two opens and an
  owner refreshing their board twice is two boards. `opened` inflates the
  denominator of `of opens`, so that rate reads *low*; `board` inflates the
  numerator of its own rate, so that one reads *high* — either way the
  opposite direction from every other number on this page. `created` and
  `started` are floors like the rest: one write per quiz made, one per
  attempt's first check. `completed` is one write per sheet the server
  answered, replays included — "See my result again" re-POSTs the stored row
  and the route counts it again — so it is exact on sheets and a ceiling on
  finishers, which is why `of starts` in §5 can read above 100%. The length
  table is built from `created` and `completed`, so its `per quiz` carries
  that replay inflation and nothing else: no ceiling in its denominator.
  (The link unfurler in the chat app is not in `opened`: it is bumped by the
  API the page's own script calls, deliberately not by `generateMetadata`,
  which every unfurler fetches.)
- **`heard` counts hint *requests* that returned a clip, not clips heard.** A
  clip that then fails to play is refunded on the phone and re-requested on
  the next tap, so a rotting CDN URL is one `heard`, one `repaired`, and one
  hint. It also does not know who asked: a taker who reloads and taps again is
  two. Against the allowance it is a ceiling; against the "no audio in a
  question" rule it is the honest number, because upstream was asked either
  way.
- **`refused by the limiter` is the exception in the other direction — it is
  exact.** A refusal means the `incr` that said no succeeded, so the counter
  beside it lands too.

What the table answers reliably is **trend** and **relative difference between
surfaces**. Not absolute level.

---

## 7. What to do about what you see

No hard thresholds, because there is no baseline yet and the first version's
placement and wording dominate the numbers. A made-up percentage would get a
working call to action deleted. Collect two weeks first. Shapes, not numbers:

| Observation | Reading | Next |
|---|---|---|
| `Days with any activity` is 0 | **plumbing, not a result** — a real zero still bumps the liveness marker | check credentials, that `/r` deployed, that robots did not over-block |
| one arm's `shown` is 0, others fine | that surface is not being counted at all | its surface string or `active` condition broke — it is not that nobody saw it |
| `shown` is 0 but `followed` is not | **proof** it is the impression that is missing, not the surface | a click cannot arrive from a surface nobody was shown, so the link works and only the denominator is absent — check that something actually calls `reportLoopImpression` for it |
| arms differ sharply | placement and timing are being measured | make the low arm look like the high arm; do not delete it |
| `buzz_cta` well below `join_submitted` | "a round resolved" is the wrong proxy for the right moment | that is the signal that changing the buzzer protocol for a real end-of-game CTA is worth it |
| `Repeat hosts` share rising | someone actually came back | monetisation moves from next quarter to next month |
| `Repeat hosts` stays low | **not** "nobody returns" | cross-check against GA4 returning users, which rides a cookie and is unaffected by the ITP eviction above |
| `quiz_result` reads like `share` after two weeks | this audience does not convert off-site, link or QR alike | the reading D9 in `decisions.md` said it would reopen on — a real answer, worth having |
| `per quiz` below 1 | quizzes are being made and not sent | the share step on `/quiz` (`components/quiz-panel.tsx`), not the questions |
| `of starts` well under 40% | takers start and do not finish | read the `questions` table before touching anything: if `per quiz` falls with length, the default is too long — shorten `QUIZ_DEFAULT_QUESTION_COUNT` in `types/quiz.ts`; if it is flat, length is not the reason |
| `started` well under `opened` | takers open the card and never tap a half | the intro — the name field and the Start button on `app/q/[code]/quiz-client.tsx` — not the questions. Remember `opened` is a ceiling (§6), so this reads worse than it is |
| `typed` rows are empty after two weeks | nobody uses the typed field | leave it; it costs nothing on screen. Delete it only if the quiz form needs the room |
| `built shorter` is a large share of `created` | hosts want longer quizzes than their playlists give | say so on the panel (`components/quiz-panel.tsx`) before the link is shared, or cap the picker at the playlist's usable count once it is known |
| `board` well under `created` | owners send the link and do not come back for results | the board is where the owner's share button is, so this is a second share arm going unused — put the results where the owner already is (`/quiz`'s `QuizPanel` already remembers the last quiz) rather than growing the board |
| `heard per completed` near the allowance | takers spend every hint they have | at two options a hint is a whole point, so the verdict spread is flattering; read `stranger` as the honest bucket, and consider one per twenty |
| `unavailable` a visible share of hints | the quiz is being served in throttled minutes | same reading as the preview cache's `unavailable` row below it: the shared egress IP is being throttled, and the quiz is one more caller on it. Not a quiz problem |
| `repaired` climbing | the year-long positive cache is rotting under the quiz | expected at a low rate; a jump means the CDN rotated a batch. Nothing to do unless `heard` falls with it |
| `refused: answer` above 0 | a room of phones behind one address hit the answer limit | raise `QUIZ_ANSWER_LIMIT` in `app/api/quiz/[code]/answer/route.ts` — it was 20 and refused the 21st finisher in an office, which is why it is 60 |
| `refused: read` above 0 | the same room hit the read limit — opens that never became opens | `QUIZ_READ_LIMIT` in `app/api/quiz/[code]/route.ts`; the two limits are sized together, keep them so |
| `refused: check` above 0 | a room of phones behind one address answered faster than the check limit — questions answered with no verdict shown, which nobody reports because the page just advances | `QUIZ_CHECK_LIMIT` in `app/api/quiz/[code]/check/route.ts`; it is per question, not per taker, so size it to takers × questions per window. The other half of a lost verdict — timeouts, offline, a slow KV — never reaches the server; GA4's `quiz_check_lost` (bucketed `reason`) is where those are |
| `refused: card` above 0 | one address asked for more than sixty *uncached* card renders in ten minutes — every one past that was sent the site's generic picture instead | `QUIZ_CARD_LIMIT` in `app/q/[code]/opengraph-image.tsx`. Sixty is sixty different quizzes unfurled through one crawler address; a real chat app's crawler farm spreads over many, so a non-zero here is more likely a scraper than a good day |
| verdicts pile at `soulmate` | the decoys are too easy to tell from the playlist | the trigger for a Spotify-backed decoy source (`artists/{id}/top-tracks`) — `CHANGELOG.md` 1.9.0, known gaps |
| verdicts pile at `guessing` and `stranger` | takers are at or below a coin: the decoys are indistinguishable from the playlist, or the link is reaching people who do not know the owner | read the two apart from `close`/`acquaintance` before touching the decoys — a spread that is *only* the bottom two is the sending, not the questions |

---

## 8. Troubleshooting

**`No counters found under "loop:stats:"`** — not empty data, a missing
namespace. Either nothing has been recorded yet, or the key prefix in
`lib/loop-stats.ts` changed without the script. Deliberately loud rather than a
table of zeros.

**Table empty but `Days with any activity` is not 0** — something is writing,
but not loop events. If only `games` moves, people are playing and no surface is
being shown; usually a component that stopped rendering.

**Everything low, just after a deploy** — expected. Counters start at deploy and
do not backfill, and the 60-day attribution window means today's clicks convert
weeks from now. **The first few days carry almost no information.**

**`N click(s) were dropped by the rate limiter`** — expected, not an attack. The
limiter is keyed by IP and a party is a dozen phones behind one Wi-Fi address.
It means every rate above is understated by that much. Only a persistently large
figure justifies raising `LOOP_LIMIT` in `app/r/[surface]/route.ts`.

---

## 9. Why the script holds no metric list

`scripts/loop-stats.mjs` walks `loop:stats:*` with `SCAN` and parses what comes back
rather than rebuilding keys from a hardcoded list. That list already exists in
`lib/loop-stats.ts`, and a second copy would drift silently — the script would
read keys nobody writes and print a confident table of zeros. Discovery also
means a metric added later appears here without anyone editing the script — as
far as the *counting* goes. Rendering is per key shape, so a new metric that no
block recognises falls into the "Other counters" list at the bottom rather than
being read, summed and silently dropped, which is what used to happen.

The only shared knowledge is the `loop:stats:` prefix, and changing that makes
the script print "no counters found", which is loud rather than wrong.

One shape of drift the "Other counters" block does **not** catch: a new key
under a prefix a renderer already claims. `RENDERED_PREFIXES` marks `quiz:`,
`quiz_len:`, `quiz_hint:` and the rest as consumed, so a `quiz:reopened` added
to `lib/loop-stats.ts` without a line in the quiz block would be read, summed,
and printed nowhere — the exact silence the leftovers block exists to end,
back through a side door. A new metric under a claimed prefix needs its own
line in that block; a new metric under a new prefix can lean on the leftovers
until it deserves better. `tests/loop-stats.test.ts` pins the writer's key
set and `tests/quiz-routes.test.ts` pins that the routes still call it, but
nothing can pin the script's output — read it once after adding a counter.

### `SCAN`, not `KEYS`, and the difference is not academic

`KEYS` matches against **every key in the instance**, not every key under the
prefix — so the size of this namespace was never the number that decided
whether it worked. `lib/preview-cache.ts` writes one key per track and holds
positive entries for a year, and when that set crossed Upstash's ceiling the
server started refusing outright:

```
ERR KEYS command is disabled because total number of keys is too large, please use SCAN
```

`npm run stats` then exits 1 and prints nothing, for a reason with no
connection to the loop. **And it had been wrong before it was loud.** On
2026-08-15 the same seven-day window read, minutes apart:

| | `KEYS` | `SCAN` |
|---|---|---|
| Days with any activity | 5/7 | 7/7 |
| Games started | 4918 | 6740 |
| `join_submitted` | 42 shown / 19 followed — 45.2% | 92 / 30 — 32.6% |
| `game_over` | 936 / 8 — 0.9% | 1274 / 10 — 0.8% |

The truncation was silent and it was not uniform: two whole days of liveness
markers were missing, which is why the report claimed 5/7 — the exact reading
§7 says to treat as a plumbing problem rather than a result. **Any figure quoted
from a run before this fix is a partial sum.** The relative ordering of the
surfaces survived, which is what §6 says the table is good for; the levels did
not, which is what §6 says it is not.

`MGET` is chunked at 256 for the neighbouring reason: the REST transport puts
the whole command in one request body, and that body would otherwise grow with
the namespace.
