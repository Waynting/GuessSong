import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.guessong.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "GuessSong — Spotify Party Game",
    template: "%s | GuessSong",
  },
  description:
    "Play a clip, guess the song. 猜歌遊戲 — 免費音樂猜歌 app，支援任何 Spotify 歌單，無需登入，多人同樂。A free music guessing game for parties — works with any Spotify playlist, no login required, local multiplayer.",
  keywords: [
    "music guessing game",
    "spotify party game",
    "song guessing game",
    "music quiz",
    "party game",
    "local multiplayer",
    "spotify playlist game",
    "猜歌",
    "猜歌遊戲",
    "音樂猜歌",
    "派對遊戲",
    "Spotify 猜歌",
    "音樂遊戲",
    "猜歌活動",
    "猜歌 app",
    "音樂問答",
    "朋友聚會遊戲",
  ],
  authors: [{ name: "GuessSong" }],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "GuessSong",
    title: "GuessSong — Spotify Party Game",
    description:
      "Play a clip, guess the song. Works with any Spotify playlist, no login required.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GuessSong — Spotify Party Game",
    description:
      "Play a clip, guess the song. Works with any Spotify playlist, no login required.",
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
    url: BASE_URL,
    description:
      "A free music guessing game for parties. Works with any Spotify playlist, no login required.",
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <html lang="zh-TW">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
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
        {children}
      </body>
    </html>
  );
}

