import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { PwaSetup } from "@/components/pwa-setup";
import "./globals.css";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "GuessSong — Guess Song Party Game",
    template: "%s | GuessSong",
  },
  description:
    "Play a clip, guess the song. GuessSong is a free guess song party game for any Spotify playlist — no login required, local multiplayer fun for friends and family.",
  keywords: [
    "music guessing game",
    "spotify party game",
    "song guessing game",
    "guess song",
    "guess song game",
    "music quiz",
    "party game",
    "local multiplayer",
    "spotify playlist game",
    "guess the song",
    "name that tune",
    "music trivia",
    "song quiz",
    "party music game",
    "free online party game",
    "friends game night",
    "music game for parties",
    "spotify trivia",
    "猜歌",
    "猜歌遊戲",
    "音樂猜謎遊戲",
    "派對猜歌遊戲",
    "spotify 猜歌",
  ],
  authors: [{ name: "GuessSong" }],
  manifest: "/manifest.json",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "GuessSong",
    title: "GuessSong — Guess Song Party Game",
    description:
      "Play a clip, guess the song. A free guess song game for any Spotify playlist, no login required.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GuessSong — Guess Song Party Game",
    description:
      "Play a clip, guess the song. A free guess song game for any Spotify playlist, no login required.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: "#1DB954",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "GuessSong",
    alternateName: ["Guess Song", "Guess the Song", "猜歌", "猜歌遊戲"],
    url: BASE_URL,
    description:
      "A free guess song game for parties. Works with any Spotify playlist, no login required.",
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        {/* Catch beforeinstallprompt before React hydrates — Chrome can fire
            it earlier than any useEffect. lib/pwa.ts picks it up from
            window.__bipEvent on init. */}
        <Script id="bip-capture" strategy="beforeInteractive">
          {`window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bipEvent=e;});`}
        </Script>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');
              `}
            </Script>
          </>
        )}
        <PwaSetup />
        {children}
      </body>
    </html>
  );
}

