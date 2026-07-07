import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * Serves the PWA manifest icons (/icons/192, /icons/512, /icons/maskable)
 * as generated PNGs, matching the app/icon.tsx favicon design so no binary
 * assets need to live in the repo.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;

  const px = size === "192" ? 192 : 512;
  const maskable = size === "maskable";
  if (size !== "192" && size !== "512" && !maskable) {
    return new Response("Not found", { status: 404 });
  }

  // Maskable icons must keep content inside the central 80% safe zone.
  const fontSize = maskable ? px * 0.5 : px * 0.68;

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
          borderRadius: maskable ? 0 : px * 0.22,
        }}
      >
        <div
          style={{
            fontSize,
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
    { width: px, height: px }
  );
}
