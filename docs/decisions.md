# Decisions

Why the product is shaped this way, and what was considered and rejected.

Kept in the repo on purpose. Most of these were argued out in design documents
that live outside it, which means a fresh clone — or the same person in six
months — has the constraints without the reasoning, and re-litigates a settled
question from scratch. Each entry names the alternative and what would make it
worth reopening.

---

## D1 — No accounts, ever

**Decided:** from launch. Reaffirmed 2026-08.

There is no login, no user record, and nothing in storage keyed to a person. A
host pastes a link and starts; a player scans a QR and types a name.

**Rejected:** accounts, so that scores, history, and repeat hosting could be
tracked properly.

**Why:** the entire product advantage is that a party can start in about twenty
seconds, at a moment when everyone is already half-distracted. An auth screen at
that moment is not a small tax, it is the whole funnel. Every measurement
problem downstream of this — see D6 — is a price knowingly paid.

**Would reopen if:** something genuinely impossible without identity becomes the
main thing people want. Wanting *better analytics* is not that; it is the
motivation this decision exists to refuse.

---

## D2 — Web and PWA, not an App Store listing

**Decided:** 2026-07-29.

**Rejected:** shipping a native app.

**Why:** there was no user signal for it — no requests, no GA4 evidence, no
capability the PWA lacked. The actual driver was a feeling that a website "is
not a real product", and that feeling does not survive contact with the App
Store; it just changes units to "not enough downloads". Meanwhile the cost is
two platforms and a human review cycle, which turns a one-line copy change from
three minutes into three days.

The legitimacy problem was real and got a product answer instead: Buzzer Mode.
What makes Jackbox feel like a real game is not that it is installed, it is that
everybody's phone is in it.

**Unchecked risk if this is reopened:** Spotify's developer terms on game usage
are loosely enforced against a website and would be read line by line in a
manual app review. Verify that *first* — it could be an architectural rejection,
not a screen to fix.

**Would reopen if:** a concrete user signal appears, or a real PWA capability
gap. Not a feeling.

---

## D3 — Buzzer rooms run on Cloudflare Durable Objects

**Decided:** 2026-07-29. This reversed an earlier decision to avoid a realtime
layer entirely.

**Rejected:** Vercel's native WebSockets, self-hosted Socket.IO, PartyKit,
Supabase Realtime, and short-interval polling.

**Why:**

- **Vercel WebSockets cannot broadcast.** The documentation is explicit that new
  connections are not guaranteed to reach the same function instance and that
  rooms and pub/sub belong in external storage. So `io.to(room).emit()` has no
  meaning there, and Upstash's REST API has no `SUBSCRIBE` to back one. Staying
  on one platform would still have required a second dependency, without any of
  the benefit.
- **Connections are bounded by `maxDuration`** — 300s on Hobby. A thirty-minute
  game means every player reconnecting six times.
- **Polling was the original plan and does not survive contact with the rate
  limiter.** `app/api/room/[code]/status` allows 200 requests per 10 minutes,
  i.e. one every three seconds, and buzzing needs sub-second. The key is also
  `room:status:${ip}`, so an entire party shares one bucket.
- A Durable Object is **single-threaded per room**, which makes "who pressed
  first" an ordinary function call instead of a distributed consensus problem.
  No locks, no CAS, no retry loop. Hibernation means an idle room costs nothing.

**Cost accepted:** a second platform, a second deploy that is not automatic
(see [operations.md](operations.md#1-two-deploys-and-only-one-is-automatic)),
and a protocol file that must stay dependency-free because both sides import it.

---

## D4 — Playlists are sampled, not read whole

**Decided:** 2026-08-03.

`fetchPlaylistTracks` reads at most `MAX_PLAYLIST_TRACKS` (500), choosing random
pages when a playlist is larger.

**Rejected:** following `next` until the playlist ends.

**Why:** Spotify throttles on the **client id**, so every visitor shares one
budget. An unbounded loop made a 4,000-track playlist cost 40 upstream requests
for a game that plays at most 50 songs. Sampling by *page* rather than by track
because a page is what a request buys.

**Cost accepted:** "All" now means "a random 500". Invisible for any playlist a
party would realistically use, but a real behaviour change — `truncated` is
returned and still not surfaced in the UI, so a host with a huge playlist gets
no indication they are hearing a sample. Sampled results cache for 1h rather
than 6h, because the TTL is also how long everyone is stuck with the same draw.

---

## D5 — Loop before monetisation

**Decided:** 2026-08-09, at 13,000+ MAU, 100% organic, zero revenue.

Order: close the loop, make repeat hosting countable, then ask about money.

**Rejected:** a paid fake door first.

**Why:** the product has no limit worth paying to remove. It is free and
unrestricted — `ROOM_MAX_SUBMISSIONS = 12`, `MAX_PLAYLIST_TRACKS = 500`, 5–30s
clips — and none of those hurt. A fake door needs a door. Creating a pain worth
charging for is a separate design problem and was not solved.

The loop went first for a different reason than "it is more important": it is
the only item that is correct **regardless of what the data says**. If nobody
returns, that proves the loop is needed; if many do, the loop amplifies it. It
was therefore not blocked on evidence nobody had.

**A related premise was wrong and is recorded here so it is not repeated.** The
first version of this argument claimed the product *structurally could not*
recognise a repeat host and deferred monetisation a full quarter on that basis.
The mechanism already existed — `getPersistentPlayerId` in
`lib/use-buzzer-socket.ts`, a persisted host name in `components/room-panel.tsx`,
and GA4's own `client_id`. The true statement was "nobody ever attached a host
identity to an event", which is a small change, not a quarter. An adversarial
review caught it. **Watch for that shape of error: an observation failure
laundered into an architectural constraint.**

**Would reopen if:** the share of games at `host_game_index >= 2` climbs. That
is the number that moves monetisation from next quarter to next month.

---

## D6 — Measure in KV as well as GA4

**Decided:** 2026-08-09.

Loop events are recorded twice: GA4 through `trackEvent`, and KV through
`lib/loop-stats.ts`, read by `npm run stats`.

**Rejected:** GA4 alone, and — separately — the GA4 Data API behind a scheduled
digest.

**Why GA4 alone is not enough:** it requires someone to open it, and across four
attempts over eight weeks that did not happen once. Every feature decision in
that period was made on an n of 1. Treat a step with a measured completion rate
of zero as unavailable and design around it, rather than assigning it a fifth
time.

**Why not the GA4 Data API:** parameter-level breakdowns need the parameter
registered as a custom dimension, registration is **not retroactive**, and GA4's
default event retention is 2 months — so the historical questions were already
unanswerable. It also put a five-step Google Cloud service-account setup on the
critical path of a plan whose entire premise was that manual steps do not get
done.

**KV is authoritative for decisions.** GA4 keeps cohorting and the questions
nobody has asked yet. They will disagree, and the gap approximates how much of
this audience blocks analytics.

---

## D7 — A command, not a scheduled digest

**Decided:** 2026-08-09, overturning the plan from earlier the same day.

`npm run stats` reads the counters. There is no cron and no webhook.

**Rejected:** a weekly Vercel Cron posting a digest to Discord or Slack.

**Why:** the digest was designed on the premise that data must *arrive*. That
framing was wrong. The variable is not push versus pull, it is whether reading
requires **leaving the editor**. A webhook adds a deploy surface, three
environment variables, and one more feed to ignore. A command in the repo runs
from the terminal that is already open — and, decisively, a coding agent can run
it unprompted.

**The line in `CLAUDE.md` telling an agent to run it is the delivery
mechanism**, not documentation of one. Delete that line and this reverts to the
same defect as GA4.

**A corollary worth generalising:** a single discrete setting change is a
reliable thing to ask a human for — flipping GA4 retention from 2 to 14 months
happened within minutes. "Open the dashboard, find the report, work out what it
means" is not. Size asks accordingly, and turn the second kind into a command.

---

## D8 — `absent` and `unavailable` are different nulls

**Decided:** 2026-08-03, after the collapsed version shipped and caused an
outage.

**Why it is here rather than only in the changelog:** it is the most expensive
mistake this codebase has made, and it is the kind that looks like a
simplification. Mapping every failure onto "no preview" and caching it for a
week meant one throttled minute at peak marked a slice of the catalogue silent
for seven days. It never reproduced locally, because a laptop's own IP is never
the one being throttled, and it presented as a catalogue gap rather than as
throttling.

Only a clean, complete reply from upstream may produce `absent`. Everything else
is `unavailable`, cached 90 seconds. **A wrong `absent` lasts a week and is
invisible; a wrong `unavailable` costs one retry.**

---

## Rejected and still rejected

Short entries, so they are not re-proposed as new ideas.

| Idea | Why not | Reopen if |
|---|---|---|
| Automated answer checking | The host being the judge is what makes it a party game rather than a quiz app; arguing with a string matcher is not fun | never, probably |
| Full-site Chinese localisation | Real leak — Chinese-keyword SEO lands on an English UI — but it connects no feedback loop, and `useErrorLocale` starts at `"en"` and switches in an effect, which is fine for an empty error slot and a full-page flash for body copy | after the loop numbers arrive, with a server-side `Accept-Language` hint |
| More game modes | Presume repeat play, the one evidence category that is entirely absent | `host_game_index >= 2` climbs |
| A `/admin` stats page | Same failure mode as GA4 with a different URL — you still have to remember to open it | never; extend `npm run stats` instead |
| Apple Music, Discord bot | Proposed and withdrawn by the author for lack of evidence, twice | a concrete user signal |
