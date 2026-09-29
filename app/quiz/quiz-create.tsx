"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { recallLoopRef, rememberLoopRef } from "@/lib/host-session";
import { arrivedFrom } from "@/lib/loop-links";
import { apiError, describeError, errorMessage, shouldRememberRejection, type ErrorLocale } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import dynamic from "next/dynamic";
import { CheckIcon, SpotifyIcon } from "@/components/setup-chrome";
import { QUIZ_COPY, fillCopy } from "@/lib/quiz-copy";
import { quizUrl, recallLastQuiz, rememberLastQuiz, rememberQuizToken, type LastQuiz } from "@/lib/quiz-session";
import { currentQuizSource } from "@/lib/quiz-source";
import {
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_NAME_MAX,
  QUIZ_QUESTION_COUNTS,
  type CreateQuizRequest,
  type CreateQuizResponse,
} from "@/types/quiz";
import { DEFAULT_QUIZ_COUNT_STATE, QUIZ_COUNT_CONTROL, quizCountOf } from "@/lib/quiz";
import { selectPreset, typeCustom, commitCustom, isCustomSelected } from "@/lib/song-count";

/**
 * A quiz this page made, as the panel shows it.
 *
 * The owner name rides along because the response does not carry it and the
 * panel outlives the form: the share sentence names whoever the quiz was
 * *made* for, and the host editing the name box afterwards — on the way to a
 * second quiz, or by accident — must not rewrite the text under a link that
 * has already been sent.
 */
type CreatedQuiz = CreateQuizResponse & { ownerName: string | null };

/**
 * What the panel is drawn from: a quiz made on this visit, or the one this
 * device remembers from an earlier one. The count is null only on the second
 * kind, and only for an entry written before it was kept.
 */
type PanelQuiz = Pick<LastQuiz, "code" | "ownerName" | "playlistName" | "questionCount" | "expiresAt">;

/**
 * The panel — and the QR library it draws with — is only ever shown after
 * `/api/quiz` answers or a remembered quiz is read back, so it stays out of
 * the page's first load: `handleCreate` warms the chunk the moment the
 * request goes out, and the panel mounts when the response lands. Never
 * server-rendered — both of its sources start null.
 *
 * Two things a lazy chunk owes the host. While it is still arriving there is
 * a placeholder where the link will be, because a re-enabled button reading
 * "Create a new link" over an empty space invites a second tap — a second
 * quiz, a second `quiz:created`, and the first link orphaned. And if the
 * chunk never arrives — the ordinary case is a tab from before a deploy
 * asking for a hash that is gone — the fallback prints the link as text. The
 * quiz exists by then; a crash screen here would hide the one thing the host
 * came for.
 */
const loadQuizPanel = () => import("@/components/quiz-panel");
const QuizPanel = dynamic(
  () => loadQuizPanel().then((m) => m.QuizPanel).catch(() => QuizPanelFallback),
  { ssr: false, loading: () => <QuizPanelPlaceholder /> }
);

/** Resolves its own language: `dynamic`'s `loading` slot is handed no props. */
function QuizPanelPlaceholder() {
  const copy = QUIZ_COPY[useErrorLocale()];
  return (
    <p style={{ fontSize: "13px", color: "#999", textAlign: "center", padding: "12px 0" }}>
      {copy.createMakingLink}
    </p>
  );
}

/** Stands in for the panel, so it is handed the panel's props — `locale` among them. */
function QuizPanelFallback({ code, locale }: { code: string; locale: ErrorLocale }) {
  const url = quizUrl(code);
  return (
    <p style={{ fontSize: "13px", color: "#ccc", textAlign: "center", lineHeight: 1.6 }}>
      {QUIZ_COPY[locale].createLinkFallback}{" "}
      <a href={url} style={{ color: "#1DB954", wordBreak: "break-all" }}>
        {url}
      </a>
    </p>
  );
}

/**
 * The quiz form. Lifted out of `app/page.tsx`, where it was a mode of the
 * party form sharing that page's URL box, Start button and error line.
 * Same `/api/*` conventions and the same rejection memo as a game start, but
 * deliberately never `recordHostedStart`: a quiz is one person making
 * something, not a room being hosted, and counting it would inflate the one
 * number the whole loop is judged on.
 *
 * ## In the visitor's language, under English metadata
 *
 * Every sentence here comes from `QUIZ_COPY[locale]` (lib/quiz-copy.ts). The
 * form was hardcoded English around a panel that was not: a Taiwanese host
 * filled in an English form and was handed a Chinese panel whose share
 * sentence went into a Chinese chat. `locale` starts at `en` and moves in an
 * effect (`useErrorLocale`), so the prerendered page — the one a crawler
 * reads, under `app/quiz/page.tsx`'s English `metadata` and an English-only
 * sitemap entry — is English, and that is deliberate. The playlist box's
 * placeholder is an address, not a sentence, and stays as it is.
 */
export function QuizCreate() {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [ownerName, setOwnerName] = useState("");
  // The question count is `lib/song-count.ts`'s control with the quiz's bounds
  // (`QUIZ_COUNT_CONTROL`): the same two rules as "Number of Songs" on the
  // party form, so a half-typed "4" on the way to "45" never becomes the count.
  const [count, setCount] = useState(DEFAULT_QUIZ_COUNT_STATE);
  const [createdQuiz, setCreatedQuiz] = useState<CreatedQuiz | null>(null);
  // What this device made last time, given back as the panel it was — see
  // lib/quiz-session.ts.
  const [lastQuiz, setLastQuiz] = useState<LastQuiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const locale = useErrorLocale();
  const copy = QUIZ_COPY[locale];

  /**
   * The last submission that failed in a way the submission itself
   * determines, and the sentence shown for it. A refused playlist comes back
   * from the negative cache in about 100ms, so the button re-enables between
   * mashes and every extra tap is another billed invocation that can only
   * replay the same refusal. Keyed on the URL and the count, so changing
   * either needs no explicit reset: the key simply stops matching.
   */
  const lastRejectedRef = useRef<{ key: string; message: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    // Attribution from /r/quiz_result. Stored rather than used immediately:
    // the person who just took a friend's quiz is not about to host a party
    // tonight, so the game this credits is weeks away. Read off
    // `window.location` for the same reason `app/page.tsx` does — an
    // unsuspended `useSearchParams` would opt the page out of prerendering.
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) rememberLoopRef(ref);
    const last = recallLastQuiz();
    setLastQuiz(last);
    // The remembered quiz is drawn with the panel, so its chunk is wanted
    // now rather than at the first Create.
    if (last) void loadQuizPanel().catch(() => {});
  }, []);

  const isValidSpotifyUrl =
    playlistUrl.includes("spotify.com/playlist") || playlistUrl.includes("spotify:playlist:");
  const isEditorial = playlistUrl.includes("37i9");

  /**
   * One panel, from whichever source has a quiz: the one just made, else the
   * one remembered. A reload used to swap the panel for a grey line linking
   * to the board — so the QR and both buttons were lost on the first
   * pull-to-refresh, for a quiz that had usually not been sent yet.
   */
  const shown: PanelQuiz | null = createdQuiz ?? lastQuiz;

  async function handleCreate() {
    setError(null);
    if (!playlistUrl.trim()) {
      setError(errorMessage("playlist_url_required", locale));
      return;
    }
    const questionCount = quizCountOf(count);
    const submissionKey = `quiz:${playlistUrl}:${questionCount}`;
    const rejected = lastRejectedRef.current;
    if (rejected && rejected.key === submissionKey) {
      setError(rejected.message);
      return;
    }
    setLoading(true);
    // Warm the panel's chunk now, so it is in hand when the response is.
    void loadQuizPanel().catch(() => {});
    // One read, for both copies: GA4's `arrived_from` and KV's `quiz_from`
    // describe the same arrival and must not be able to disagree about the
    // loop credit. `from` is a word from a closed set — the referrer it was
    // worked out from stays in `lib/quiz-source.ts`.
    const loopRef = recallLoopRef();
    const from = currentQuizSource(loopRef);
    const body: CreateQuizRequest = {
      url: playlistUrl,
      ownerName: ownerName.trim() || undefined,
      questionCount,
      locale,
      from,
    };
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw apiError(data, "quiz_create_failed");
      const created = data as CreateQuizResponse;
      const owner = ownerName.trim() || null;
      setCreatedQuiz({ ...created, ownerName: owner });
      const remembered: LastQuiz = {
        code: created.code,
        ownerName: owner,
        playlistName: created.playlistName,
        questionCount: created.questionCount,
        createdAt: Date.now(),
        expiresAt: created.expiresAt,
      };
      rememberLastQuiz(remembered);
      rememberQuizToken(created.code, created.hostToken);
      setLastQuiz(remembered);
      trackEvent("quiz_created", {
        question_count: created.questionCount,
        arrived_from: arrivedFrom(loopRef),
        quiz_from: from,
      });
    } catch (e: unknown) {
      const message = describeError(e, locale, "quiz_create_failed");
      lastRejectedRef.current = shouldRememberRejection(e)
        ? { key: submissionKey, message }
        : null;
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Header: the same shape as the party page's, so the two read as one
          site, with the one line that says what this page is instead. */}
      <div className={`text-center mb-8 ${mounted ? "fade-in fade-in-1" : ""}`}>
        <div style={{ color: "#1DB954", display: "flex", justifyContent: "center", marginBottom: "10px" }}>
          <SpotifyIcon />
        </div>
        <h1 className="hero-title">{copy.createTitle}</h1>
        <h2 style={{ color: "#666", fontSize: "15px", marginTop: "12px", fontWeight: 300 }}>
          {copy.createSubtitle}
        </h2>
      </div>

      <div
        className={`card ${mounted ? "fade-in fade-in-2" : ""}`}
        style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "24px" }}
      >
        <div>
          <p className="section-label">{copy.createPlaylistLabel}</p>
          <div style={{ position: "relative" }}>
            <input
              type="url"
              className={`url-input${isValidSpotifyUrl ? " valid" : ""}`}
              placeholder="https://open.spotify.com/playlist/..."
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              spellCheck={false}
            />
            {isValidSpotifyUrl && (
              <span
                style={{
                  position: "absolute",
                  right: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#1DB954",
                }}
              >
                <CheckIcon />
              </span>
            )}
          </div>
          {isEditorial && (
            <p
              style={{
                marginTop: "8px",
                fontSize: "12px",
                color: "#f59e0b",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>⚠</span> {copy.createEditorialWarning}
            </p>
          )}
        </div>

        <div>
          <label className="section-label" htmlFor="quiz-owner-name" style={{ display: "block" }}>
            {copy.createNameLabel}
          </label>
          <input
            id="quiz-owner-name"
            type="text"
            className="player-input"
            placeholder={copy.createNamePlaceholder}
            value={ownerName}
            maxLength={QUIZ_NAME_MAX}
            style={{ width: "100%" }}
            onChange={(e) => setOwnerName(e.target.value)}
          />
          {/* The title is the friend's page's own string, so what is shown
              here is what will be read there, in the same language. */}
          <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
            {fillCopy(copy.createTitlePreview, {
              title: fillCopy(copy.introTitleOwner, { owner: ownerName.trim() || "…" }),
            })}
          </p>
        </div>

        <div>
          <p className="section-label">{copy.createQuestionsLabel}</p>
          {/* The pills and the field are two ways to set one number. */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {QUIZ_QUESTION_COUNTS.map((c) => (
              <button
                key={c}
                className={`pill${count.count === c && !isCustomSelected(count, QUIZ_COUNT_CONTROL) ? " active" : ""}`}
                onClick={() => setCount(selectPreset(c))}
              >
                {c}
              </button>
            ))}
            <input
              type="number"
              inputMode="numeric"
              min={QUIZ_MIN_QUESTIONS}
              max={QUIZ_MAX_QUESTIONS}
              className={`pill count-input${isCustomSelected(count, QUIZ_COUNT_CONTROL) ? " active" : ""}`}
              placeholder={`${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS}`}
              aria-label={fillCopy(copy.createCustomCountLabel, {
                min: QUIZ_MIN_QUESTIONS,
                max: QUIZ_MAX_QUESTIONS,
              })}
              value={count.field}
              onChange={(e) => {
                // Read the value before the updater React runs later.
                const raw = e.target.value;
                setCount((s) => typeCustom(s, raw, QUIZ_COUNT_CONTROL));
              }}
              onBlur={() => setCount((s) => commitCustom(s, QUIZ_COUNT_CONTROL))}
            />
          </div>
          {/* This is the party form's "Number of Songs" control under another
              label, and there the host is the one who sits through the count.
              Here it is the friends, who were not asked: in the week to
              2026-09-29 forty of seventy-seven owners picked something longer
              than the default, and the thirties and fifties were finished by
              nobody. The line says who answers and what happens to long ones;
              the picker itself — presets, default, bounds — is untouched. */}
          <p style={{ marginTop: "8px", fontSize: "12px", color: "#666", lineHeight: 1.5 }}>
            {copy.createLengthNote}
          </p>
        </div>

        {/* The link, with the button that makes another one below it. The
            panel stays up while the host edits the form — a tap on a count
            pill is not a decision to throw away a link that may already be
            in a group chat — and is replaced only by the next quiz. A quiz
            from an earlier visit gets a line saying so; one just made does
            not need telling. */}
        {shown && (
          <div>
            {!createdQuiz && <p className="section-label">{copy.createLastQuiz}</p>}
            <QuizPanel
              code={shown.code}
              ownerName={shown.ownerName}
              playlistName={shown.playlistName}
              questionCount={shown.questionCount}
              expiresAt={shown.expiresAt}
              locale={locale}
            />
          </div>
        )}

        <div>
          {/* Worded as a second link once one exists: pressing it makes a new
              code, it does not change the one already sent. */}
          <button className="start-btn" onClick={handleCreate} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                {copy.createLoading}
                <span className="dot-pulse" />
              </>
            ) : shown ? (
              copy.createAgainButton
            ) : (
              copy.createButton
            )}
          </button>

          {/* `role="alert"`: a failed submit is announced, not just painted. */}
          {error && (
            <div
              role="alert"
              style={{
                marginTop: "12px",
                padding: "12px 16px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#fca5a5",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <div className="mode-links">
            <Link href="/" className="text-link">
              {copy.createBackToParty}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
