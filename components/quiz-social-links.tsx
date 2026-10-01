"use client";

/**
 * A row of post-to-a-platform links — LINE, Threads, X, Facebook, WhatsApp —
 * under a quiz's share buttons, on a browser with no share sheet.
 *
 * Of 21 owner share taps, 3 opened a sheet: most quizzes are made on a
 * laptop, where the share button can only fall back to the clipboard. On a
 * phone the system sheet already lists every one of these apps, so the row is
 * not drawn there. Whether the sheet exists is decided in an effect after
 * mount and the row starts hidden, so the server render and the first client
 * render agree.
 *
 * Plain `<a target="_blank">`, never a click handler that opens a window: the
 * new tab is what keeps this page alive for the report, and a popup opened
 * after an await is what a blocker refuses. The address handed over is the
 * caller's plain `/q/<CODE>` — the one a friend opens — and never anything
 * that marks the owner.
 *
 * Each tap reports through `reportQuizSocial` and nothing else. The share and
 * Copy buttons beside it have their own reporters, and this row folded into
 * either would make that counter mean two things again.
 *
 * Its own `<style>`, because it is drawn on three surfaces with three styling
 * conventions (inline on `/quiz`, Tailwind on the board, the duel sheet on
 * the taker's result) and must look and press the same on all of them.
 */

import { useEffect, useState } from "react";
import type { ErrorLocale } from "@/lib/error-messages";
import { reportQuizSocial } from "@/lib/loop-client";
import type { QuizShareBy } from "@/lib/loop-stats";
import { QUIZ_COPY } from "@/lib/quiz-copy";
import {
  SOCIAL_PLATFORM_LABELS,
  socialPlatformsFor,
  socialShareUrl,
  type SocialPlatform,
} from "@/lib/social-share";

const SOCIAL_CSS = `
  .quiz-social { margin-top: 14px; text-align: center; }
  .quiz-social-lead { font-size: 12px; color: #999; margin: 0 0 8px; }
  .quiz-social-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .quiz-social-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid #333;
    background: #1a1a1a;
    color: #f0f0f0;
    font-family: 'Outfit', sans-serif;
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  @media (hover: hover) {
    .quiz-social-link:hover { border-color: #1DB954; color: #fff; }
  }
  .quiz-social-link:active { background: #222; border-color: #1DB954; transform: scale(0.97); transition: none; }
  .quiz-social-link:focus-visible { outline: 2px solid #1DB954; outline-offset: 2px; }
`;

export function QuizSocialLinks({
  by,
  url,
  text,
  locale,
}: {
  by: QuizShareBy;
  /** The plain quiz address, `/q/<CODE>`. */
  url: string;
  /** The share sentence without the address; the platforms that take one field get both. */
  text: string;
  locale: ErrorLocale;
}) {
  // Hidden until the effect has looked: a server render cannot know, and
  // starting visible would flash the row on every phone.
  const [noSheet, setNoSheet] = useState(false);
  useEffect(() => {
    setNoSheet(typeof navigator.share !== "function");
  }, []);

  if (!noSheet) return null;

  function handleSocial(platform: SocialPlatform) {
    reportQuizSocial(by, platform);
  }

  return (
    <div className="quiz-social">
      <style>{SOCIAL_CSS}</style>
      <p className="quiz-social-lead">{QUIZ_COPY[locale].socialLead}</p>
      <ul className="quiz-social-row">
        {socialPlatformsFor(locale).map((platform) => (
          <li key={platform}>
            <a
              className="quiz-social-link"
              href={socialShareUrl(platform, { url, text })}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => handleSocial(platform)}
            >
              {SOCIAL_PLATFORM_LABELS[platform]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
