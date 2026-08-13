import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { PwaSetup } from "@/components/pwa-setup";
import "./globals.css";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";
// The publisher id is a public identifier, not a secret — it ships in the
// script URL on every page and in public/ads.txt, which has to match it.
const ADSENSE_CLIENT =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID || "ca-pub-2238954049312975";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    // The generic phrase carries the title, not the brand — nobody searches
    // "guesssong" except people who already know us.
    default: "Guess the Song — Free Music Guessing Party Game | GuessSong",
    template: "%s | GuessSong",
  },
  description:
    "Play a clip, guess the song. GuessSong is a free guess the song game that turns any Spotify playlist into a music quiz for parties — no login, no app, no sign-up.",
  keywords: [
    "guess the song",
    "guess the song game",
    "guess song",
    "music guessing game",
    "song guessing game",
    "name that tune",
    "music quiz game",
    "spotify playlist game",
    "party game for friends",
    "猜歌遊戲",
    "猜歌",
  ],
  authors: [{ name: "GuessSong" }],
  manifest: "/manifest.json",
  robots: { index: true, follow: true },
  // The homepage is a client component and can't export its own metadata, so
  // the canonical lives here. /about and /zh override it; the ephemeral room
  // routes that also inherit it are disallowed in robots.ts.
  alternates: {
    canonical: "/",
    languages: { en: "/", "zh-TW": "/zh", "x-default": "/" },
  },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "GuessSong",
    title: "Guess the Song — Free Music Guessing Party Game",
    description:
      "Play a clip, guess the song. A free guess the song game for any Spotify playlist — no login required.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Guess the Song — Free Music Guessing Party Game",
    description:
      "Play a clip, guess the song. A free guess the song game for any Spotify playlist — no login required.",
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
    alternateName: [
      "Guess the Song",
      "Guess Song",
      "Guess the Song Game",
      "Music Guessing Game",
      "猜歌",
      "猜歌遊戲",
    ],
    url: BASE_URL,
    description:
      "A free guess the song game for parties. Turns any Spotify playlist into a music guessing quiz — no login required.",
    applicationCategory: "GameApplication",
    applicationSubCategory: "Music Quiz Game",
    operatingSystem: "Web",
    browserRequirements: "Requires a modern browser with audio playback",
    inLanguage: ["en", "zh-TW"],
    isAccessibleForFree: true,
    featureList: [
      "Guess the song from a 5–30 second audio clip",
      "Works with any public Spotify playlist",
      "Mixed Playlist Mode — merge everyone's playlists into one round",
      "Buzzer mode using players' phones",
      "Local multiplayer, no accounts and no sign-up",
    ],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* AdSense's loader goes in <head>, which is where the account's site
            review looks for it — next/script's afterInteractive would put it in
            the body instead. Skipped outside production so localhost and
            `next dev` never register impressions against the account. */}
        {ADSENSE_CLIENT && process.env.NODE_ENV === "production" && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            crossOrigin="anonymous"
          />
        )}
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

