"use client";

/**
 * /q/[code]/board — the owner's results page.
 *
 * What rikaido.me calls the results dashboard: who took it, the ranking, and
 * per question how many got it. Host-only, because the per-question rows name
 * the answers; the token comes from this device's localStorage
 * (`lib/quiz-session.ts`), which is the only place "the person who made it"
 * exists without an account. On any other device the page says so and points
 * at the quiz, whose public ranking is the part that is safe to show anyone.
 *
 * The two tiles at the top — the song everyone knew, the song nobody could
 * place — are the part the owner screenshots back into the chat, so they get
 * the display type and the tint; the fifty rows under them are for reading,
 * not for sharing, and stay a list with a hairline bar each. Which question
 * earns a tile is `pickBoardTiles` in lib/quiz.ts, where the suite can reach
 * it: the rule was inline here first and crowned a 1-of-2 question "Everyone
 * knew".
 *
 * A client page rather than a server one: there is no unfurl to serve here
 * (nobody shares their own results URL), and the token is in the browser.
 * The tab title is set by hand once the board is in, since a client page has
 * no `generateMetadata`; it is the quiz's own title, the string the taker's
 * tab shows, so the two tabs read as one thing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { apiError, describeError, errorMessage } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import { pickBoardTiles } from "@/lib/quiz";
import { QUIZ_COPY, fillCopy, formatQuizDate, ownerShareText, quizTitle } from "@/lib/quiz-copy";
import { quizUrl, recallQuizToken } from "@/lib/quiz-session";
import { COPIED_FLASH_MS, copyLink, shareLink, type ShareLinkOutcome } from "@/lib/quiz-share";
import { Button } from "@/components/ui/button";
import type { QuizBoardQuestion, QuizBoardResponse } from "@/types/quiz";
import { Shell } from "../shell";

type Phase = "loading" | "not_host" | "error" | "ready";

/**
 * The Shell loads Bebas Neue; the Tailwind config has no token for it. The
 * weight and `font-synthesis` match the Shell's `.q-display`: Bebas has no
 * CJK glyphs, so a Chinese song title falls to the system sans, which should
 * use its real bold rather than sit a weight lighter than the Latin one above.
 */
const display = { fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSynthesis: "none" } as const;

/**
 * The first fetch replaces the page with "Loading…"; a refresh keeps the
 * board up and only disables the button, because the owner tapped it to see
 * a number change, not to watch the page blank.
 */
type LoadMode = "initial" | "refresh";

export default function QuizBoardPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const locale = useErrorLocale();
  const copy = QUIZ_COPY[locale];

  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<QuizBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  // `quiz_board_opened` is one open, however many times the board is fetched.
  // The KV twin (`quiz:board`) counts per fetch and is documented as a ceiling
  // for that reason; the GA4 copy is the cohort, and a refresh is not a cohort.
  const opened = useRef(false);

  const load = useCallback(
    async (mode: LoadMode = "initial") => {
      if (mode === "initial") {
        setPhase("loading");
        setError(null);
      } else {
        setRefreshing(true);
        setRefreshError(null);
      }
      try {
        const token = recallQuizToken(code);
        if (!token) {
          setPhase("not_host");
          return;
        }
        // The token rides in a header, as the room's does — never the query
        // string, which access logs keep.
        const res = await fetch(`/api/quiz/${encodeURIComponent(code)}/board`, {
          cache: "no-store",
          headers: { "x-host-token": token },
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 403) {
            setPhase("not_host");
            return;
          }
          throw apiError(data, "quiz_board_failed");
        }
        const loaded = data as QuizBoardResponse;
        setBoard(loaded);
        setPhase("ready");
        if (!opened.current) {
          opened.current = true;
          trackEvent("quiz_board_opened", {
            question_count: loaded.questionCount,
            takers: loaded.takers,
          });
        }
      } catch (e: unknown) {
        const message = describeError(e, locale, "quiz_board_failed");
        if (mode === "refresh") {
          // The board on screen is still the last good one; say the refresh
          // failed under the button rather than replace it with the error page.
          setRefreshError(message);
        } else {
          setError(message);
          setPhase("error");
        }
      } finally {
        if (mode === "refresh") setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale only colours the sentence
    [code]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A client page has no `generateMetadata`, so without this the tab reads
  // the site default. Nothing to restore on unmount: the whole tab is the board.
  useEffect(() => {
    if (!board) return;
    document.title = `${quizTitle(copy, board.ownerName)} | GuessSong`;
  }, [board, copy]);

  const url = quizUrl(code);

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  }

  /**
   * `copied` flashes the button. `failed` — no share sheet and a clipboard
   * that refused, which is what a locked-down webview does — says so under
   * the buttons and points at the URL printed above them, which is selectable.
   * `shared` and `dismissed` need no line: the owner watched the sheet open.
   */
  function reportOutcome(outcome: ShareLinkOutcome) {
    setShareFailed(outcome === "failed");
    if (outcome === "copied") flashCopied();
    trackEvent("quiz_share_tapped", { by: "owner", outcome });
  }

  async function handleShare() {
    if (!board) return;
    reportOutcome(await shareLink({ url, text: ownerShareText(copy, board) }));
  }

  async function handleCopy() {
    reportOutcome(await copyLink(url));
  }

  if (phase === "loading") {
    return (
      <Shell>
        <p className="text-center text-sm text-[#999]">{copy.loading}</p>
      </Shell>
    );
  }

  if (phase === "not_host") {
    return (
      <Shell>
        <Notice title={copy.boardPageTitle} body={errorMessage("quiz_not_host", locale)}>
          <Button asChild variant="outline">
            <a href={`/q/${code}`}>{copy.boardOpenQuiz} →</a>
          </Button>
        </Notice>
      </Shell>
    );
  }

  if (phase === "error" || !board) {
    return (
      <Shell>
        <Notice title={copy.boardPageTitle} body={error ?? ""}>
          <Button variant="outline" onClick={() => void load()}>
            {copy.retry}
          </Button>
        </Notice>
      </Shell>
    );
  }

  const title = quizTitle(copy, board.ownerName);

  // Unanimous questions only, judged by at least two takers — the rule and
  // its reasons are on `pickBoardTiles`. Each tile is literal or absent.
  const picked = pickBoardTiles(board.questions);
  const tiles = (["easiest", "hardest"] as const).flatMap((kind) => {
    const i = picked[kind];
    return i === undefined ? [] : [{ kind, q: board.questions[i] }];
  });

  return (
    <Shell>
      <div className="flex w-full max-w-md flex-col gap-10 py-4 sm:max-w-lg">
        <header>
          <p className="text-[11px] uppercase tracking-[0.25em] text-[#666]">
            GuessSong · {copy.boardPageTitle}
          </p>
          <h1
            style={{ ...display, fontSize: "clamp(40px, 12vw, 64px)", textWrap: "balance" }}
            className="mt-2 leading-[0.95] text-[#f0f0f0]"
          >
            {title}
          </h1>
          <p className="mt-3 text-sm font-medium text-[#1DB954]">{board.playlistName}</p>
          <p className="mt-1 text-sm text-[#999]">
            {fillCopy(copy.boardQuestionCount, { count: board.questionCount })} ·{" "}
            {fillCopy(copy.boardTakers, { count: board.takers })}
            {board.averageCorrect !== null && (
              <>
                {" "}
                ·{" "}
                {fillCopy(copy.boardAverage, {
                  avg: board.averageCorrect.toFixed(1),
                  total: board.questionCount,
                })}
              </>
            )}
          </p>
          {/* One fetch per tap and never a poll: the route allows 60 per 10 minutes per IP */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load("refresh")}>
              {refreshing ? copy.boardRefreshing : copy.boardRefresh}
            </Button>
            {refreshError && (
              <p role="alert" className="text-xs text-[#f5b942]">
                {refreshError}
              </p>
            )}
          </div>
        </header>

        {/* The two songs the whole board turned on — what the owner screenshots.
            With takers but no unanimous question there is nothing true to say
            here; the per-question list below says the rest. */}
        {board.takers === 0 ? (
          <p className="text-sm leading-relaxed text-[#999]">{copy.boardEmpty}</p>
        ) : tiles.length > 0 ? (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tiles.map(({ kind, q }) => (
              <Tile
                key={kind}
                label={kind === "easiest" ? copy.boardEasiest : copy.boardHardest}
                tint={kind === "easiest" ? "29, 185, 84" : "245, 185, 66"}
                question={q}
                rateLine={fillCopy(copy.boardCorrectRate, { correct: q.correct, answered: q.answered })}
              />
            ))}
          </section>
        ) : null}

        {/* Per question — the part that makes this page host-only */}
        <section>
          <SectionLabel>{copy.boardPerQuestion}</SectionLabel>
          <ol className="flex flex-col">
            {board.questions.map((q, i) => {
              const rate = q.answered > 0 ? q.correct / q.answered : null;
              const pct = rate === null ? 0 : Math.round(rate * 100);
              return (
                <li key={i} className="border-b border-[#222] py-2.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm">
                      <span className="mr-2 text-[11px] tabular-nums text-[#666]">
                        {fillCopy(copy.boardQuestionLabel, { n: i + 1 })}
                      </span>
                      <span className="font-medium text-[#f0f0f0]">{q.title}</span>
                      {q.artist && <span className="text-[#888]"> · {q.artist}</span>}
                    </span>
                    <span
                      className={`shrink-0 text-sm tabular-nums ${rate === null ? "text-[#666]" : "text-[#f0f0f0]"}`}
                      title={
                        rate === null
                          ? undefined
                          : fillCopy(copy.boardCorrectRate, { correct: q.correct, answered: q.answered })
                      }
                    >
                      {rate === null ? copy.boardNoData : `${pct}%`}
                    </span>
                  </div>
                  <div className="mt-2 h-[2px] w-full overflow-hidden bg-[#262626]" aria-hidden="true">
                    <div className="h-full bg-[#1DB954]" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {board.scoreboard.length > 0 && (
          <section>
            <SectionLabel>{copy.boardRankingTitle}</SectionLabel>
            <ol className="flex flex-col">
              {board.scoreboard.map((r, i) => (
                <li
                  key={`${i}-${r.name}`}
                  className="flex items-center gap-3 border-b border-[#222] py-2 last:border-0"
                >
                  <span
                    style={{ ...display, fontSize: "26px" }}
                    className={`w-8 shrink-0 leading-none tabular-nums ${i < 3 ? "text-[#1DB954]" : "text-[#666]"}`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[#f0f0f0]">{r.name}</span>
                  {r.hintsUsed > 0 && (
                    <span className="shrink-0 text-xs text-[#666]" title={copy.boardHintsColumn}>
                      🎧{r.hintsUsed}
                    </span>
                  )}
                  <span className="shrink-0 text-sm tabular-nums text-[#f0f0f0]">
                    {r.correct} / {r.total}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Getting more people onto it is the whole job of this page */}
        <section className="flex flex-col gap-2">
          <p className="break-all text-center font-mono text-xs text-[#1DB954]">
            {url.replace(/^https?:\/\//, "")}
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void handleShare()}>
              {copy.boardShareLink} →
            </Button>
            <Button variant="secondary" onClick={() => void handleCopy()}>
              {copied ? copy.copied : copy.boardCopyLink}
            </Button>
          </div>
          {shareFailed && (
            <p role="alert" className="text-center text-xs leading-relaxed text-[#f5b942]">
              {copy.boardShareFailed}
            </p>
          )}
          <Button asChild variant="outline">
            <a href={`/q/${code}`}>{copy.boardOpenQuiz} →</a>
          </Button>
          <p className="mt-2 text-center text-xs text-[#666]">
            {fillCopy(copy.expires, { date: formatQuizDate(board.expiresAt, locale) })}
          </p>
        </section>
      </div>
    </Shell>
  );
}

/** One of the two hero tiles. `tint` is an "r, g, b" triple washed over the surface. */
function Tile({
  label,
  tint,
  question,
  rateLine,
}: {
  label: string;
  tint: string;
  question: QuizBoardQuestion;
  rateLine: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl p-5"
      style={{
        background: `linear-gradient(135deg, rgba(${tint}, 0.22), rgba(${tint}, 0.04)), #1a1a1a`,
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#999]">{label}</p>
      <p
        style={{ ...display, fontSize: "clamp(28px, 8vw, 44px)", textWrap: "balance" }}
        className="mt-1 leading-none text-[#f0f0f0]"
      >
        {question.title}
      </p>
      {question.artist && <p className="text-sm text-[#999]">{question.artist}</p>}
      <p className="mt-2 text-xs tabular-nums text-[#bbb]">{rateLine}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] uppercase tracking-[0.25em] text-[#666]">{children}</p>;
}

/** The gate and the error, same shape: a title, a sentence, one thing to do. */
function Notice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
      <p className="text-[11px] uppercase tracking-[0.25em] text-[#666]">GuessSong</p>
      <h1 style={{ ...display, fontSize: "clamp(36px, 10vw, 48px)" }} className="leading-none text-[#f0f0f0]">
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-[#999]">{body}</p>
      {children}
    </div>
  );
}
