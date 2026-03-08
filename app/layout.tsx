import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GuessSong — Spotify Party Game",
  description: "Play a clip, guess the song. A local party music guessing game.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

