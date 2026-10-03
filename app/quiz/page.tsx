import type { Metadata } from "next";
import { SetupBackdrop, SetupStyles } from "@/components/setup-chrome";
import { ServiceNotice } from "@/components/service-notice";
import { QUIZ_ABOUT } from "@/lib/quiz-about";
import { QuizCreate } from "./quiz-create";
import { QuizAboutAndFooter } from "./quiz-about";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

/**
 * The Taste Quiz's own page.
 *
 * The quiz was a third pill on the party form at `/` — "Single Playlist ·
 * Mixed Playlist · Taste Quiz" — and that put "not a party" beside the two
 * things that are, on the page whose whole job is starting a party. It is
 * 1.4% of what `/` creates and its link is the loop's one warm arm, so it
 * gets a page that is only about it: one form, one button, and the link.
 *
 * Indexable, in the sitemap, and canonical on itself: unlike `/q/<code>`
 * this is a durable page describing a feature, not an ephemeral link. The
 * root layout's canonical would otherwise be inherited here.
 */
export const metadata: Metadata = {
  title: "Spotify Playlist Quiz: Who Knows Your Music Taste?",
  description:
    "Make a music taste quiz from any public Spotify playlist in seconds. Send one link; friends pick which of two songs is really yours, and a leaderboard shows who knows your taste best. Free, no login, no app.",
  keywords: [
    "spotify playlist quiz",
    "music taste quiz",
    "how well do you know my music taste",
    "spotify quiz for friends",
    "playlist guessing game",
  ],
  alternates: { canonical: "/quiz" },
  openGraph: {
    title: "How Well Do Your Friends Know Your Music Taste? | GuessSong",
    description:
      "Turn your Spotify playlist into a quiz link. Friends guess which songs are really yours — and a leaderboard shows who knows your taste best.",
    url: "/quiz",
    type: "website",
    siteName: "GuessSong",
    // A page-level openGraph replaces the root's whole block, image included.
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "How Well Do Your Friends Know Your Music Taste? | GuessSong",
    description:
      "Turn your Spotify playlist into a quiz link. Friends guess which songs are really yours — and a leaderboard shows who knows your taste best.",
    images: ["/opengraph-image"],
  },
};

export default function QuizPage() {
  // One graph, three nodes, every value read from the English copy — the
  // language the page is prerendered in, so schema and page agree.
  const about = QUIZ_ABOUT.en;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: "GuessSong Taste Quiz",
        url: `${BASE_URL}/quiz`,
        applicationCategory: "GameApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires a web browser",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description: metadata.description,
      },
      {
        "@type": "HowTo",
        name: "How to make a music taste quiz from a Spotify playlist",
        step: about.steps.map((step, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: step.title,
          text: step.text,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: about.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <SetupStyles />
      <SetupBackdrop />
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px",
          position: "relative",
        }}
      >
        <div style={{ width: "100%", maxWidth: "480px" }}>
          <QuizCreate />
          <ServiceNotice />
          {/* How it works, the FAQ and the footer, in the device's language
              like the form above — prerendered in English, which is what the
              JSON-LD below is built from (lib/quiz-about.ts). */}
          <QuizAboutAndFooter />
        </div>
      </main>
    </>
  );
}
