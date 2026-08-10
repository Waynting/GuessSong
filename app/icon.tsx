import { ImageResponse } from "next/og";

// Deliberately NOT `runtime = "edge"`. Edge disables static generation for the
// route ("Using edge runtime on a page currently disables static generation for
// that page"), which turned this into a per-request satori rasterisation billed
// as Active CPU. On the Node runtime it is rendered once at build time and
// served as a static asset, which is what the favicon always wanted to be.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: "#1DB954",
            display: "flex",
            lineHeight: 1,
          }}
        >
          G
        </div>
      </div>
    ),
    { ...size }
  );
}
