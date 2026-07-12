# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
