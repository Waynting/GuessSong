import type { Metadata } from "next";
import { SetupBackdrop, SetupStyles } from "@/components/setup-chrome";
import { ServiceNotice } from "@/components/service-notice";
import { SiteFooter } from "@/components/site-footer";
import { QuizCreate } from "./quiz-create";

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
  title: "Make a Taste Quiz from Your Spotify Playlist",
  description:
    "Turn any public Spotify playlist into a quiz link. Friends open it on their phone, guess which songs are really yours, and a leaderboard shows who knows your taste best. Free, no login.",
  alternates: { canonical: "/quiz" },
  openGraph: {
    title: "Make a Taste Quiz | GuessSong",
    description:
      "A link your friends open to guess which songs are really in your playlist — and find out who knows your taste best.",
    url: "/quiz",
  },
};

export default function QuizPage() {
  return (
    <>
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
          <SiteFooter />
        </div>
      </main>
    </>
  );
}
