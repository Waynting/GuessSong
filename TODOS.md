# TODOS

## Setup page

### One-tap "Just me" start from the decades list

**What:** Let a solo visitor start the order game from the "Just me" tile without pasting a link, using the owner-held decades playlist.

**Why:** 84% of games are solo and 89% of first-time hosts arrive from Google; a paste is the step between the tile and the game. The 2026-11-10 review (CEO 0G E2) kept it out until the decades chip has a read of its own.

**Context:** Needs the `decades` starter from PR A2b (`startersFor("order")`, `host_setup_starter:decades`). Trigger: the decades chip is the most-picked chip over a week and `game_left_source:starter:r0` has fallen from ~130/day. A default playlist changes the `/` flow the owner designed in #67, so it is a product call, not a follow-up fix. Hero `<h2>` stays untouched regardless.

**Effort:** M
**Priority:** P3
**Depends on:** PR A2b merged and read

### "Not sure? Reveal anyway" sub-line on the order game's first round

**What:** A one-line sub-prompt under "Oldest on top…" on round 1 while nothing has been moved.

**Why:** 82% of round-0 order bounces moved nothing; a stuck host may not know a reveal is allowed. Deferred (CEO 0G E4) because two first-screen cues at once cannot be told apart in `order_bounce`.

**Context:** Trigger: `order_bounce:*:untouched` unchanged a week after PR A2b (prompt contrast, grip, last-card cue, ghost Reveal, left-as-dealt line). If it moved, this is unnecessary.

**Effort:** S
**Priority:** P3
**Depends on:** PR A2b read

## Playlist links

### Per-bucket refusal sentences for Liked Songs and profile links

**What:** `playlist_link_collection` ("needs your login; GuessSong can't read it") and `playlist_link_user` ("open one of your playlists and paste that") beside the coarse `playlist_link_spotify_other` sentence.

**Why:** ~104 refusals/day were "anything else" with no split; PR A1 splits them and ships one bucket-neutral sentence. Deferred (CEO 0G E3) until the split says which bucket is large.

**Context:** `unplayableKind` in `lib/spotify-link.ts` already names the buckets; `params.kind` is on the response. Trigger: `spotify_collection` or `spotify_user` is the largest bucket in `npm run stats` a week after A1. Liked Songs cannot be lifted (user auth); profile links can be guided.

**Effort:** M
**Priority:** P3
**Depends on:** PR A1 read

## Design

### DESIGN.md for the site

**What:** A design-system file (tokens, type, spacing, motion) for GuessSong, via `/design-consultation`.

**Why:** No DESIGN.md exists; every design review re-derives the palette from CLAUDE.md's "Styling Conventions" prose. The 2026-11-10 design review rated design-system alignment 8/10 with this as the remaining gap.

**Context:** Tokens in use: `#111` bg, `#1a1a1a` cards, `#1DB954` accent, `#888` secondary, Bebas Neue + Outfit, inline `<style>` blocks on the setup and game pages, Tailwind + shadcn elsewhere.

**Effort:** L
**Priority:** P4
**Depends on:** None

### A second order-game starter list

**What:** A second owner-held playlist for the order style (e.g. "One-hit wonders 1970–2010") beside "Hits from every decade".

**Why:** One chip under a caption reads thin; two give a choice. Deferred by the design review until the first list has a read.

**Context:** `startersFor("order")` already partitions by style; the entry needs an owner-held public playlist id (22 base62 chars, not `37i9`), ≥ 40 dated tracks across many years, no compilations.

**Effort:** S
**Priority:** P4
**Depends on:** PR A2b read

## Completed
