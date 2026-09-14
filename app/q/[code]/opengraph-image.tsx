/**
 * The quiz link's card image: whose taste, how many questions, in the
 * owner's language.
 *
 * This is the one generated image on the site that is not built once, and
 * it breaks the rule CLAUDE.md's "SEO / Metadata" section states on purpose.
 * The picture is most of a chat card, and the site's static card sells the
 * party game — three pills about playlists and multiplayer under a title
 * that names the owner read as canned, which is what the owner who shared it
 * said. A quiz is `ƒ` because its card is: the owner's name and the count
 * are in KV, not in the build.
 *
 * What keeps it off the hot path is the header, not the runtime. Next serves
 * a dynamic metadata image with `ImageResponse`'s own `immutable, max-age=
 * 31536000`, which caches it in the *browser* that fetched it — and an
 * unfurler fetches once and keeps nothing, so that header made every share
 * a render. `s-maxage` is what Vercel's edge honours: one render per quiz
 * per region per day, however many friends the link reaches, and a quiz's
 * words never change for its week. A card that could not be read is held a
 * minute, so a KV blink does not pin the generic card on a real quiz.
 *
 * No `runtime = "edge"` — it would not make this static, and it would drop
 * the Node `fetch` the CJK font below needs. The title is rendered in
 * whatever script the owner typed; `next/og` fetches the glyphs a script
 * needs from Google Fonts per render (Noto Sans TC for Han, subset to the
 * text), which is the one upstream call here and is paid on the cached
 * schedule above. No emoji, for the same reason: each one is a fetch.
 *
 * Header key is lower-case `cache-control` because `ImageResponse` spreads
 * caller headers over its own lower-case defaults; a capitalised key would
 * be *appended* by `Headers`, and the edge would read two directives.
 */

import { ImageResponse } from "next/og";
import { peekQuiz, type QuizPeek } from "@/lib/quiz-store";
import { quizCardCopy } from "@/lib/quiz-copy";

export const alt = "Music taste quiz on GuessSong";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** A day at the edge; the card's words are fixed for the quiz's week. */
const FOUND_CACHE_CONTROL = "public, max-age=0, s-maxage=86400";
/** Gone, malformed, or KV blinked: short, so a real quiz is not stuck with the generic card. */
const MISSING_CACHE_CONTROL = "public, max-age=0, s-maxage=60";

/** Past this many characters the title drops a size so three lines still fit. */
const LONG_TITLE = 36;

type Params = { params: Promise<{ code: string }> };

export default async function QuizCard({ params }: Params) {
  const { code } = await params;
  const peek = await peekQuiz(code);
  return new ImageResponse(<Card peek={peek} />, {
    ...size,
    headers: { "cache-control": peek ? FOUND_CACHE_CONTROL : MISSING_CACHE_CONTROL },
  });
}

function Card({ peek }: { peek: QuizPeek | null }) {
  const { label, title, subtitle, pills } = quizCardCopy(peek);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "52px 64px 56px",
        background: "#111111",
        color: "#f0f0f0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* The site card's glow, moved off-centre so the words sit in it. */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(29,185,84,0.28) 0%, rgba(29,185,84,0) 68%)",
          top: -180,
          left: -120,
        }}
      />

      {/* Wordmark and what this is. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 6,
            color: "#1DB954",
          }}
        >
          GUESSSONG
        </div>
        <div
          style={{
            display: "flex",
            padding: "8px 22px",
            borderRadius: 999,
            border: "1px solid rgba(29,185,84,0.45)",
            background: "rgba(29,185,84,0.12)",
            color: "#1DB954",
            fontSize: 22,
          }}
        >
          {label}
        </div>
      </div>

      {/* The question. Wraps to three lines at most at either size. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
        <div
          style={{
            display: "flex",
            fontSize: title.length > LONG_TITLE ? 60 : 74,
            fontWeight: 700,
            lineHeight: 1.18,
            letterSpacing: -1,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ display: "flex", fontSize: 32, color: "#1DB954" }}>{subtitle}</div>
        )}
      </div>

      {/* The count and the rule. */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {pills.map((pill) => (
          <div
            key={pill}
            style={{
              display: "flex",
              padding: "10px 24px",
              borderRadius: 999,
              border: "1px solid #2a2a2a",
              background: "#1a1a1a",
              color: "#aaaaaa",
              fontSize: 24,
            }}
          >
            {pill}
          </div>
        ))}
      </div>
    </div>
  );
}
