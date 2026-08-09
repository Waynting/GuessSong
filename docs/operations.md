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
npm test              # 351 tests, ~1.5s
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
| `SPOTIFY_CLIENT_ID` / `_SECRET` | pasting a playlist URL fails; the three built-in trial playlists still work |
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
it prints is a floor — §6 there explains why that matters more than it sounds.

### The caches

No endpoint, by design; an endpoint would need an auth story for what is a
two-line grep. In the Vercel logs:

```
[playlist-cache] miss id=… source=… hits=… negative=… misses=… rate=…
[preview-cache]  miss hits=… misses=… unavailable=… rate=…
```

Both log **only on a miss**, so the instrumentation gets quieter as things get
healthier and a sudden run of lines is itself the signal.

Two traps in reading those lines, both of which have cost a debugging detour:

- **Trust `source=`, not the log row's method.** Only `POST /api/playlist` and
  `POST /api/room/[code]/submit` can emit the line, but Vercel attributes it to
  whichever request the instance happened to be serving, so it frequently
  appears against an unrelated `GET`.
- **`rate` counts a replayed 404 as a hit.** Correctly — it answered without
  touching Spotify — so a host retrying a dead link pushes the rate *up*.
  `negative=` is that subset; `hits - negative` is the part describing real
  playlists. The bucket is a **UTC** day, so a rate read just after 00:00 UTC is
  measuring almost nothing.

---

## 5. Symptoms

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

### "Spotify says 429"

The cooldown in `lib/playlist-cache.ts` parks all *uncached* loads for the
`Retry-After` duration (clamped 30s–15min), shared across instances via KV.
Cached playlists keep serving throughout, so a party already mid-game is
unaffected.

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

### "The room disappeared mid-game"

Mixed Playlist rooms use `ROOM_TTL_SECONDS = 30 * 60`, counted from **creation**
and deliberately not extended by activity (`types/room.ts`, `lib/room.ts`). That
is correct for a one-shot playlist mailbox and wrong for anything that must
outlive a full game. Buzzer rooms are a different system with a sliding timeout.

### "A clip plays but the answer card disagrees"

A wrong recording was cached as correct. Positive preview entries are held a
**year**, and `&refresh=1` repairs rotted URLs, not wrong songs. The matching
rules are in `lib/preview-cache.ts` — see the 1.2.0 changelog entry for why the
tier list is ordered the way it is. Fixing one means invalidating that track's
key, not bumping the cache version: a version bump cold-starts every entry in
production simultaneously, which is the upstream stampede the module exists to
prevent.

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
