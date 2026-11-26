# TODOS

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

### One-tap "Just me" start from the decades list

**Completed:** 1.25.0 (2026-11-26). "Just me" with an empty field starts the order game on the decades starter (`soloDefaultStarter` in `lib/starter-playlists.ts`); the line under Start names the list. It is an ordinary starter start, so there is no counter of its own — read `host_setup_starter:decades` and the starter column's round-0 leaves.

### "Not sure? Reveal anyway" sub-line on the order game's first round

**Completed:** 1.25.0 (2026-11-26). `ORDER_COPY.*.prompt.unsure`, under Reveal on round one while nothing has moved. Trigger met: `order_bounce:*:untouched` was 86% of round-0 bounces two weeks after the first-screen cues. Read `order_bounce` against 32.7% of `order 1` starts.
