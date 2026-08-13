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

## 2. The six surfaces

Each is declared **once** in `lib/loop-links.ts` and derived from there by the
link, the analytics param, and the server-side validator. The order below is the
order of that declaration, which reads down the funnel: the two passive footers,
the two moments a player has just finished doing something, then the two QR
codes.

| Surface | Where | When |
|---|---|---|
| `buzz_footer` | buzzer page, all three return paths (`app/buzz/[code]/page.tsx:210`, `:243`) | always, including the pre-join form |
| `buzz_cta` | buzzer page, full-width button (`app/buzz/[code]/page.tsx:289`) | between rounds, after the first resolves |
| `join_footer` | Mixed Playlist submit page (`app/j/[code]/page.tsx:147`) | always |
| `join_submitted` | Mixed Playlist confirmation screen (`app/j/[code]/page.tsx:103`) | after a playlist is submitted |
| `game_over` | QR on the host's Game Over screen (`app/game/page.tsx`, `<LoopQr />`) | party mode, end of game |
| `share` | QR drawn into the result card image (`lib/result-image.ts`'s `drawCardFooter`) | wherever the picture ends up |

### Why one declaration

The name is needed in three places at once, and hand-syncing them fails
*silently*. A renamed `href` against a stale validator still redirects — the
counter simply stops incrementing, and that arm reads as "nobody clicked it".
You would then correctly conclude the call to action was useless and delete one
that was working. Same single-union trick `lib/buzzer-protocol.ts` uses across
the Worker boundary.

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
unavailable: the visitor reaches `/` regardless, and only the count is lost. The
person clicking is precisely the person this feature exists to reach.

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

Games started       33
Repeat hosts        4    12.1% of games

Games by host's game number
   1     21  █████████████████████████
   2      3  ████
  10+     1  █
```

| Field | Meaning |
|---|---|
| `Days with any activity` | days that recorded anything. **Read this first** |
| `shown` | the surface was rendered, once per surface per tab. `share` is the exception — see below |
| `followed` | someone clicked and the server saw it |
| `rate` | `followed ÷ shown` |
| `Games started` | real hosted parties. Solo built-in trials are excluded |
| `Repeat hosts` | games at index ≥ 2. **The number this work is waiting on** |

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

`scripts/loop-stats.mjs` runs `KEYS loop:stats:*` and parses what comes back
rather than rebuilding keys from a hardcoded list. That list already exists in
`lib/loop-stats.ts`, and a second copy would drift silently — the script would
read keys nobody writes and print a confident table of zeros. Discovery also
means a metric added later appears here without anyone editing the script.

The only shared knowledge is the `loop:stats:` prefix, and changing that makes
the script print "no counters found", which is loud rather than wrong.

`KEYS` is the wrong tool on a large database. This namespace is a few hundred
keys with a 30-day TTL and the command runs by hand.
