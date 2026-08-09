# Docs

Reference material for working on GuessSong. Four documents, each answering a
question the others do not.

| Document | Answers |
|---|---|
| [architecture.md](architecture.md) | How the pieces fit, in diagrams |
| [viral-loop.md](viral-loop.md) | How the loop works, and how to read `npm run stats` |
| [operations.md](operations.md) | It is broken / it is slow / how do I deploy the Worker |
| [decisions.md](decisions.md) | Why it is like this, and what was rejected |

---

## What belongs here, and what does not

This project already documents itself in four other places, and the way a
`docs/` directory dies is by becoming a fifth copy that slowly disagrees with
all of them. So the boundary is explicit:

| Lives in | Contains | Do not duplicate it here |
|---|---|---|
| `README.md` | Setup, scripts, project layout, API route list | Getting started |
| `CLAUDE.md` | Invariants and hazards an agent must not undo | Rules and constraints |
| `CHANGELOG.md` | What changed, when, and the reasoning at the time | Per-release detail |
| `lib/changelog.ts` | The same releases in plain language, bilingual, for players | Anything player-facing |
| Code comments | Why *this line* is the way it is | Line-level rationale |

**`docs/` is for the things that do not fit any of those**: a picture of the
whole system, a runbook for when something is wrong, an end-to-end walkthrough
of one feature, and a record of decisions with the alternatives that were
rejected. Everything here should still be true in six months; anything that is
only true for one release belongs in `CHANGELOG.md`.

`dev_docs/` is gitignored and stays that way. It holds planning artifacts for
features that have since shipped — the buzzer plan written at 4,000 users, the
Mixed Playlist specs — which are useful history and would be stale content in a
tracked directory.

## Keeping it honest

Every claim about the code here should name a file, and ideally a line. That is
not decoration: a documented behaviour with no pointer is unverifiable, and
unverifiable documentation is how a directory like this stops being trusted.
When a pointer goes stale, the fix is to follow it and correct the prose, not
to remove the pointer.
