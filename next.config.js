/** @type {import('next').NextConfig} */

// Testing Buzzer Mode means real phones on the same Wi-Fi hitting the dev
// server by LAN IP, not localhost. Next dev refuses cross-origin /_next/*
// requests unless the origin is listed here (a warning today, an error in a
// future major version).
//
// Add your machine's LAN IP via .env.local rather than editing this file:
//   DEV_ORIGINS=10.107.0.98,192.168.1.42
// Hostnames only, no scheme and no port. Dev-only; production builds ignore it.
const devOrigins = [
  "127.0.0.1",
  "localhost",
  ...(process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: devOrigins,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
    ],
  },
};

module.exports = nextConfig;
