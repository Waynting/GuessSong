"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { QUIZ_ABOUT } from "@/lib/quiz-about";
import { useErrorLocale } from "@/lib/use-error-locale";

/**
 * The explainer, the FAQ and the footer under the quiz form, in the device's
 * language — the same `useErrorLocale` the form reads, so the page is one
 * language top to bottom. Prerendered as English (the hook starts at `en` and
 * moves in an effect), which is what the crawler and the JSON-LD see; see
 * lib/quiz-about.ts.
 *
 * The footer is drawn here rather than in the server page because its locale
 * is only known after mount: a Chinese page over an English footer was the
 * same seam one block further down.
 */

const sectionHeading = {
  fontFamily: "'Bebas Neue', sans-serif",
  fontSize: "30px",
  letterSpacing: "0.02em",
  color: "#f0f0f0",
  margin: "0 0 20px",
  fontWeight: 400,
} as const;
const stepNumber = {
  flexShrink: 0,
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  border: "1px solid rgba(29,185,84,0.5)",
  color: "#1DB954",
  fontSize: "13px",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
const itemTitle = { fontSize: "15px", fontWeight: 600, color: "#f0f0f0", margin: 0 } as const;
const bodyText = { fontSize: "14px", lineHeight: 1.6, color: "#999", margin: "6px 0 0" } as const;
const inlineLink = { color: "#1DB954", textDecoration: "underline", textUnderlineOffset: "3px" } as const;

export function QuizAboutAndFooter() {
  const locale = useErrorLocale();
  const about = QUIZ_ABOUT[locale];

  return (
    <div lang={locale === "zh" ? "zh-Hant-TW" : undefined}>
      <section aria-labelledby="quiz-how" style={{ marginTop: "56px", color: "#bbb" }}>
        <h2 id="quiz-how" style={sectionHeading}>
          {about.howTitle}
        </h2>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "18px" }}>
          {about.steps.map((step, i) => (
            <li key={step.title} style={{ display: "flex", gap: "14px" }}>
              <span style={stepNumber}>{i + 1}</span>
              <div>
                <h3 style={itemTitle}>{step.title}</h3>
                <p style={bodyText}>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="quiz-faq" style={{ marginTop: "48px", color: "#bbb" }}>
        <h2 id="quiz-faq" style={sectionHeading}>
          {about.faqTitle}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {about.faqs.map((faq) => (
            <div key={faq.q}>
              <h3 style={itemTitle}>{faq.q}</h3>
              <p style={bodyText}>{faq.a}</p>
            </div>
          ))}
        </div>
        <p style={{ ...bodyText, marginTop: "28px" }}>
          {about.closing.before}
          <Link href={about.partyHref} style={inlineLink}>
            {about.closing.party}
          </Link>
          {about.closing.middle}
          <Link href="/guides" style={inlineLink}>
            {about.closing.guides}
          </Link>
          {about.closing.after}
        </p>
      </section>
      <SiteFooter locale={locale} />
    </div>
  );
}
