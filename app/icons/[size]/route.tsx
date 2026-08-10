import { ImageResponse } from "next/og";

/**
 * Serves the PWA manifest icons (/icons/192, /icons/512, /icons/maskable)
 * as generated PNGs, matching the app/icon.tsx favicon design so no binary
 * assets need to live in the repo.
 *
 * There are exactly three of these and they never change, so they are enumerated
 * below and rendered at build time. Previously this carried `runtime = "edge"`,
 * which opts a route out of static generation entirely — every icon fetch ran a
 * satori rasterisation on demand, billed as Active CPU, for three files whose
 * bytes are fixed at build. `dynamicParams = false` makes any other segment a
 * 404 without invoking a function at all, which is what the hand-written size
 * check here used to do one invocation too late.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }, { size: "maskable" }];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;

  const px = size === "192" ? 192 : 512;
  const maskable = size === "maskable";

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
