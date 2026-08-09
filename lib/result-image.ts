/**
 * Shared canvas helpers for GuessSong's downloadable result images (score
 * card, taste card). Centralizes the DPR-aware canvas setup, header/footer
 * chrome, and the share-sheet-or-download save flow so each card only needs
 * to draw its own content rows.
 */

export interface ResultCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function createResultCanvas(width: number, height: number): ResultCanvas {
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

export function drawCardBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);

  const accent = ctx.createLinearGradient(0, 0, width, 0);
  accent.addColorStop(0, "#1DB954");
  accent.addColorStop(1, "#0a8f3c");
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, 4);
}

export interface HeaderOptions {
  width: number;
  kicker: string;
  title: string;
  subtitle?: string;
}

/** Draws kicker/title/subtitle + divider, returns the y just below the divider. */
export function drawCardHeader(ctx: CanvasRenderingContext2D, opts: HeaderOptions): number {
  const { width, kicker, title, subtitle } = opts;

  ctx.fillStyle = "#1DB954";
  ctx.font = "bold 13px sans-serif";
  ctx.letterSpacing = "2px";
  ctx.fillText(kicker, 40, 48);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px sans-serif";
  ctx.letterSpacing = "1px";
  ctx.fillText(title, 40, 100);

  if (subtitle) {
    ctx.fillStyle = "#666666";
    ctx.font = "15px sans-serif";
    ctx.letterSpacing = "0px";
    const text = subtitle.length > 50 ? subtitle.slice(0, 50) + "…" : subtitle;
    ctx.fillText(text, 40, 130);
  }

  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 155);
  ctx.lineTo(width - 40, 155);
  ctx.stroke();

  return 155;
}

/**
 * How much vertical room `drawCardFooter` needs.
 *
 * Exported so the two callers that size their canvas cannot drift from what
 * the footer actually draws — a footer taller than its band gets silently
 * clipped, and the thing that would get clipped is the QR.
 */
export const CARD_FOOTER_HEIGHT = 112;

const QR_SIZE = 60;

/** Loads a data URL into something `drawImage` accepts. */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  if (typeof img.decode === "function") {
    await img.decode();
    return img;
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("qr image failed to load"));
  });
  return img;
}

/**
 * Draws the footer: a divider, a QR back to the site, and the credit.
 *
 * ## Why a QR and not the address in text
 *
 * This card is the only artifact the product makes that leaves the party. It
 * used to read "Played with GuessSong" — a brand with no address — so anyone
 * who saw it in a group chat had to already know the name to act on it, which
 * is exactly the audience it does not need to reach. Printing the URL as text
 * is barely better: nobody retypes a URL off a screenshot.
 *
 * The URL is deliberately *not* also put in the `navigator.share` payload. iOS
 * drops `url` when a file is attached, and several Android targets drop the
 * *file* when a `url` is present — risking the image, which is the entire
 * payload, to add a link one platform throws away is a bad trade. The pixels
 * are the carrier.
 *
 * Async because generating the QR is. Fails soft: a QR that will not render
 * leaves the credit line in place rather than failing the save, since the
 * player asked for a picture of their scores and is owed one either way.
 */
export async function drawCardFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  qrDataUrl?: string | null
) {
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(width - 40, y);
  ctx.stroke();

  let textX = 40;
  if (qrDataUrl) {
    try {
      const img = await loadImage(qrDataUrl);
      ctx.drawImage(img, 40, y + 14, QR_SIZE, QR_SIZE);
      textX = 40 + QR_SIZE + 16;
    } catch {
      // Keep the credit at the left margin; the card still saves.
    }
  }

  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = "#1DB954";
  ctx.fillText("GuessSong", textX, y + 42);

  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#666";
  ctx.fillText(
    qrDataUrl ? "Scan to play your own" : "guessong.app",
    textX,
    y + 64
  );
}

/**
 * Which path the save actually took. These are not interchangeable for
 * measurement: "shared" means the image left the device through the share
 * sheet (the only outcome that can spread), "downloaded" means it landed in
 * the filesystem and usually stops there, and "dismissed" means the user
 * opened the sheet and backed out — a tap, but not a share.
 */
export type ShareOutcome = "shared" | "dismissed" | "downloaded" | "failed";

/**
 * Save: prefer the share sheet with an image file — on Android/iOS that
 * offers "Save to Photos", and data-URL anchor downloads are unreliable
 * inside installed PWAs (WebAPK). Fallback: blob URL download.
 */
export function shareOrDownloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  shareTitle: string
): Promise<ShareOutcome> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve("failed");
        return;
      }
      const file = new File([blob], filename, { type: "image/png" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: shareTitle });
          resolve("shared");
          return;
        } catch (e) {
          // User closed the share sheet — not an error, don't force a download.
          if (e instanceof DOMException && e.name === "AbortError") {
            resolve("dismissed");
            return;
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = file.name;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      resolve("downloaded");
    }, "image/png");
  });
}
