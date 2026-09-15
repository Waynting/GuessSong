"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { recallLoopRef, rememberLoopRef } from "@/lib/host-session";
import { arrivedFrom } from "@/lib/loop-links";
import { apiError, describeError, errorMessage, shouldRememberRejection } from "@/lib/error-messages";
import { useErrorLocale } from "@/lib/use-error-locale";
import dynamic from "next/dynamic";
import { CheckIcon, SpotifyIcon } from "@/components/setup-chrome";
import { quizUrl, recallLastQuiz, rememberLastQuiz, rememberQuizToken, type LastQuiz } from "@/lib/quiz-session";
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
 * The panel — and the QR library it draws with — is only ever shown after
 * `/api/quiz` answers, so it stays out of the page's first load: `handleCreate`
 * warms the chunk the moment the request goes out, and the panel mounts when
 * the response lands. Never server-rendered — `createdQuiz` starts null.
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

function QuizPanelPlaceholder() {
  return (
    <p style={{ fontSize: "13px", color: "#999", textAlign: "center", padding: "12px 0" }}>
      Making your link…
    </p>
  );
}

function QuizPanelFallback({ code }: { code: string }) {
  const url = quizUrl(code);
  return (
    <p style={{ fontSize: "13px", color: "#ccc", textAlign: "center", lineHeight: 1.6 }}>
      Your quiz link:{" "}
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
 */
export function QuizCreate() {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [ownerName, setOwnerName] = useState("");
  // The question count is `lib/song-count.ts`'s control with the quiz's bounds
  // (`QUIZ_COUNT_CONTROL`): the same two rules as "Number of Songs" on the
  // party form, so a half-typed "4" on the way to "45" never becomes the count.
  const [count, setCount] = useState(DEFAULT_QUIZ_COUNT_STATE);
  const [createdQuiz, setCreatedQuiz] = useState<CreatedQuiz | null>(null);
  // What this device made last time, offered back as the way to the board —
  // see lib/quiz-session.ts.
  const [lastQuiz, setLastQuiz] = useState<LastQuiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const locale = useErrorLocale();

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
    setLastQuiz(recallLastQuiz());
  }, []);

  const isValidSpotifyUrl =
    playlistUrl.includes("spotify.com/playlist") || playlistUrl.includes("spotify:playlist:");
  const isEditorial = playlistUrl.includes("37i9");

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
    const body: CreateQuizRequest = {
      url: playlistUrl,
      ownerName: ownerName.trim() || undefined,
      questionCount,
      locale,
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
        createdAt: Date.now(),
        expiresAt: created.expiresAt,
      };
      rememberLastQuiz(remembered);
      rememberQuizToken(created.code, created.hostToken);
      setLastQuiz(remembered);
      trackEvent("quiz_created", {
        question_count: created.questionCount,
        arrived_from: arrivedFrom(recallLoopRef()),
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
        <h1 className="hero-title">Taste Quiz</h1>
        <h2 style={{ color: "#666", fontSize: "15px", marginTop: "12px", fontWeight: 300 }}>
          A link your friends open to guess your taste — and find out who knows you best.
        </h2>
      </div>

      <div
        className={`card ${mounted ? "fade-in fade-in-2" : ""}`}
        style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "24px" }}
      >
        <div>
          <p className="section-label">Spotify Playlist</p>
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
              <span>⚠</span> Editorial playlists (Discover Weekly, etc.) may not work
            </p>
          )}
        </div>

        <div>
          <label className="section-label" htmlFor="quiz-owner-name" style={{ display: "block" }}>
            Your Name
          </label>
          <input
            id="quiz-owner-name"
            type="text"
            className="player-input"
            placeholder="Whose taste is this? (optional)"
            value={ownerName}
            maxLength={QUIZ_NAME_MAX}
            style={{ width: "100%" }}
            onChange={(e) => setOwnerName(e.target.value)}
          />
          <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
            Goes in the title: &ldquo;How well do you know {ownerName.trim() || "…"}&rsquo;s music taste?&rdquo;
          </p>
        </div>

        <div>
          <p className="section-label">Questions</p>
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
              aria-label={`Custom number of questions, ${QUIZ_MIN_QUESTIONS} to ${QUIZ_MAX_QUESTIONS}`}
              value={count.field}
              onChange={(e) => {
                // Read the value before the updater React runs later.
                const raw = e.target.value;
                setCount((s) => typeCustom(s, raw, QUIZ_COUNT_CONTROL));
              }}
              onBlur={() => setCount((s) => commitCustom(s, QUIZ_COUNT_CONTROL))}
            />
          </div>
        </div>

        {/* The link, with the button that makes another one below it. The
            panel stays up while the host edits the form — a tap on a count
            pill is not a decision to throw away a link that may already be
            in a group chat — and is replaced only by the next quiz. */}
        {createdQuiz && (
          <QuizPanel
            code={createdQuiz.code}
            ownerName={createdQuiz.ownerName}
            playlistName={createdQuiz.playlistName}
            questionCount={createdQuiz.questionCount}
            expiresAt={createdQuiz.expiresAt}
            locale={locale}
          />
        )}
        {!createdQuiz && lastQuiz && (
          <p style={{ fontSize: "12px", color: "#666", textAlign: "center" }}>
            Your last quiz{lastQuiz.playlistName ? ` (${lastQuiz.playlistName})` : ""} is still
            open —{" "}
            <a href={`/q/${lastQuiz.code.toUpperCase()}/board`} className="link-btn">
              see who knows you best →
            </a>
          </p>
        )}

        <div>
          {/* Worded as a second link once one exists: pressing it makes a new
              code, it does not change the one already sent. */}
          <button className="start-btn" onClick={handleCreate} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Loading playlist
                <span className="dot-pulse" />
              </>
            ) : createdQuiz ? (
              "Create a new link →"
            ) : (
              "Create quiz link →"
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
              ← Back to the party game
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
