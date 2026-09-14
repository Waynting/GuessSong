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
 * The edge only knows the exact URL, so the header alone is not a ceiling:
 * a query string or a lower-case code is a fresh render, and satori is the
 * most CPU-expensive thing the app does. Three things bound it, in order —
 * a malformed code goes straight to the static site card without touching
 * KV or satori; a code spelled differently from its canonical is sent to
 * the canonical URL so a quiz has one cache key; and what remains is
 * counted against `quiz:card` per address like every other route, refused
 * renders also falling back to the static card. Unfurlers follow redirects.
 *
 * No `runtime = "edge"` — it would not make this static, and it would drop
 * the Node `fetch` the CJK font needs. `next/og` would fetch Han glyphs from
 * Google Fonts by itself, but it fails soft: a refused fetch is logged, the
 * name is drawn as boxes, and the response still carries the day-long
 * header — tofu pinned at the edge with nothing to say so. So this route
 * fetches Noto Sans TC itself, subset to the card's text, under a timeout,
 * and lets the outcome choose the header: fonts in hand, a day; not, a
 * minute, and next/og's own loader gets its try. Supplying `fonts` replaces
 * the bundled Latin face, so the subset covers every string on the card.
 * `lang` still goes on the text: without it satori resolves Han to the first
 * family in its list, Noto Sans JP. No emoji: each one is a fetch too.
 *
 * No `fontWeight` either. The only Latin face `next/og` ships is a regular,
 * and Noto Sans TC arrives at 400; a declared 700 changes nothing and
 * promises a hierarchy the render does not have. Size and colour carry it.
 *
 * Header key is lower-case `cache-control` because `ImageResponse` spreads
 * caller headers over its own lower-case defaults; a capitalised key would
 * be *appended* by `Headers`, and the edge would read two directives.
 */

import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { normalizeQuizCode, peekQuiz, type QuizPeek } from "@/lib/quiz-store";
import { quizCardCopy, type QuizCardCopy } from "@/lib/quiz-copy";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { recordQuizThrottled } from "@/lib/loop-stats";

export const alt = "Music taste quiz on GuessSong";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** A day at the edge; the card's words are fixed for the quiz's week. */
const FOUND_CACHE_CONTROL = "public, max-age=0, s-maxage=86400";
/** Gone, KV blinked, or the font did not arrive: short, so a real quiz is not stuck with a lesser card. */
const MISSING_CACHE_CONTROL = "public, max-age=0, s-maxage=60";

/** The site's build-time card, where a render that must not happen is sent. */
const STATIC_CARD = "/opengraph-image";

/**
 * Renders per address per window, counted only on an edge miss. Sized for
 * unfurlers, which fetch a card once: a chat app's crawler reaching this
 * from one address sixty times in ten minutes is sixty different quizzes
 * shared through it, which is a good day, not an attack.
 */
const QUIZ_CARD_LIMIT = 60;
const QUIZ_CARD_WINDOW_SECONDS = 10 * 60;

/** Past this many characters the title drops a size so three lines still fit. */
const LONG_TITLE = 36;

/** Han glyphs sit taller in their em box than Latin; 1.18 leaves three lines of them touching. */
const HAN = /\p{Script=Han}/u;

/** The family satori would otherwise reach for last; asked for by name, subset to the text. */
const HAN_FONT_FAMILY = "Noto+Sans+TC";
/** Google Fonts serves TTF, which satori can read, to this Safari; a modern UA gets woff2, which it cannot. */
const FONT_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
const FONT_TIMEOUT_MS = 4000;

type Params = { params: Promise<{ code: string }> };

export default async function QuizCard({ params }: Params) {
  const { code } = await params;
  const canonical = normalizeQuizCode(code);
  if (!canonical) return sendTo(STATIC_CARD, FOUND_CACHE_CONTROL);
  if (canonical !== code) return sendTo(`/q/${canonical}/opengraph-image`, FOUND_CACHE_CONTROL);

  const ip = clientIpFromHeaders(await headers());
  const { allowed } = await rateLimit(`quiz:card:${ip}`, QUIZ_CARD_LIMIT, QUIZ_CARD_WINDOW_SECONDS);
  if (!allowed) {
    await recordQuizThrottled("card");
    return sendTo(STATIC_CARD, "no-store");
  }

  const peek = await peekQuiz(canonical);
  const copy = quizCardCopy(peek);
  const text = cardText(copy);
  const wantsHan = HAN.test(text);
  const hanFont = wantsHan ? await loadHanFont(text) : null;
  return new ImageResponse(<Card peek={peek} copy={copy} />, {
    ...size,
    ...(hanFont ? { fonts: [{ name: "Noto Sans TC", data: hanFont, weight: 400 as const, style: "normal" as const }] } : {}),
    headers: {
      "cache-control": peek && (!wantsHan || hanFont) ? FOUND_CACHE_CONTROL : MISSING_CACHE_CONTROL,
    },
  });
}

/** A redirect the unfurler follows; relative, so no base URL to configure. */
function sendTo(location: string, cacheControl: string): Response {
  return new Response(null, { status: 307, headers: { location, "cache-control": cacheControl } });
}

/** Every string the card draws, so one subset covers the whole render. */
function cardText(copy: QuizCardCopy): string {
  return ["GUESSSONG", copy.label, copy.title, copy.subtitle ?? "", ...copy.pills].join("");
}

/**
 * Noto Sans TC, subset to `text`, as satori wants it — or null, and the
 * caller sends the short header. Two fetches: the stylesheet, then the file
 * it names. Both under one timeout so a slow Google Fonts costs the caller
 * a few seconds, never the request.
 */
async function loadHanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const signal = AbortSignal.timeout(FONT_TIMEOUT_MS);
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${HAN_FONT_FAMILY}&text=${encodeURIComponent(text)}`,
      { headers: { "User-Agent": FONT_UA }, signal }
    );
    if (!css.ok) return null;
    const source = (await css.text()).match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
    if (!source) return null;
    const file = await fetch(source[1], { signal });
    if (!file.ok) return null;
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

function Card({ peek, copy }: { peek: QuizPeek | null; copy: QuizCardCopy }) {
  const { label, title, subtitle, pills } = copy;
  // satori reads `lang` to order its font candidates; zh-TW puts Noto Sans TC first.
  const lang = peek?.locale === "zh" ? "zh-TW" : undefined;
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
            letterSpacing: 6,
            color: "#1DB954",
          }}
        >
          GUESSSONG
        </div>
        <div
          lang={lang}
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

      {/* The question, and under it the count — the one other fact the card
          is for, at a size a chat thumbnail keeps. Wraps to three lines at
          most at either size; a 24-character handle with no spaces may break
          inside itself rather than run off the card. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
        <div
          lang={lang}
          style={{
            display: "flex",
            fontSize: title.length > LONG_TITLE ? 60 : 74,
            lineHeight: HAN.test(title) ? 1.28 : 1.18,
            letterSpacing: -1,
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div lang={lang} style={{ display: "flex", fontSize: 34, color: "#1DB954" }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* The rule, as furniture. */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {pills.map((pill) => (
          <div
            key={pill}
            lang={lang}
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
