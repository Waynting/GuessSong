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

/** Draws the footer divider + credit line at the given y. */
export function drawCardFooter(ctx: CanvasRenderingContext2D, width: number, y: number) {
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(width - 40, y);
  ctx.stroke();
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#444";
  ctx.fillText("Played with GuessSong", 40, y + 30);
}

/**
 * Save: prefer the share sheet with an image file — on Android/iOS that
 * offers "Save to Photos", and data-URL anchor downloads are unreliable
 * inside installed PWAs (WebAPK). Fallback: blob URL download.
 */
export function shareOrDownloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  shareTitle: string
): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const file = new File([blob], filename, { type: "image/png" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: shareTitle });
          resolve();
          return;
        } catch (e) {
          // User closed the share sheet — not an error, don't force a download.
          if (e instanceof DOMException && e.name === "AbortError") {
            resolve();
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
      resolve();
    }, "image/png");
  });
}
