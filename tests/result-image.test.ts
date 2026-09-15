import { describe, it, expect, vi, afterEach } from "vitest";
import { LOOP_QR_CAPTION } from "@/lib/loop-links";
import { drawCardFooter } from "@/lib/result-image";

/**
 * The footer of the result card: the one piece of the product that leaves
 * the party, drawn onto a canvas the suite does not have. jsdom gives us
 * `Image` without `decode` and never fires `onload`, so `loadImage` would
 * wait forever; the stub below decides whether the QR "loads". The context
 * is a recorder — what matters is which strings land at which x, not pixels.
 */

interface Call {
  text: string;
  x: number;
  y: number;
}

function recordingContext() {
  const fills: Call[] = [];
  const drawn: unknown[][] = [];
  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    font: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: (...args: unknown[]) => void drawn.push(args),
    fillText: (text: string, x: number, y: number) => void fills.push({ text, x, y }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, drawn };
}

function stubImage(decode: () => Promise<void>) {
  class FakeImage {
    src = "";
    decode = decode;
  }
  vi.stubGlobal("Image", FakeImage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("drawCardFooter", () => {
  it("prints the loop's QR caption, from lib/loop-links.ts, when a QR is on the card", async () => {
    stubImage(() => Promise.resolve());
    const { ctx, fills, drawn } = recordingContext();
    await drawCardFooter(ctx, 600, 100, "data:image/png;base64,QR");

    expect(drawn).toHaveLength(1);
    const caption = fills.find((f) => f.text === LOOP_QR_CAPTION);
    expect(caption).toBeDefined();
    // Beside the code, not under it: the text column starts past the QR.
    expect(caption!.x).toBeGreaterThan(40);
    expect(fills.find((f) => f.text === "GuessSong")!.x).toBe(caption!.x);
  });

  it("falls back to the bare address when there is no QR to scan", async () => {
    const { ctx, fills, drawn } = recordingContext();
    await drawCardFooter(ctx, 600, 100, null);

    expect(drawn).toHaveLength(0);
    expect(fills.map((f) => f.text)).toEqual(["GuessSong", "guessong.app"]);
    // "Scan to …" with nothing to scan would be a lie printed into a picture.
    expect(fills.some((f) => f.text === LOOP_QR_CAPTION)).toBe(false);
    for (const f of fills) expect(f.x).toBe(40);
  });

  it("keeps the credit and still saves when the QR image will not load", async () => {
    // The player asked for a picture of their scores and is owed one; a QR
    // that fails leaves the caption in place at the left margin. The caption
    // is still the scan line, because the caller believed it had a QR — the
    // failure is in the image, and the card is not the place to explain it.
    stubImage(() => Promise.reject(new Error("decode failed")));
    const { ctx, fills, drawn } = recordingContext();
    await expect(drawCardFooter(ctx, 600, 100, "data:image/png;base64,QR")).resolves.toBeUndefined();

    expect(drawn).toHaveLength(0);
    expect(fills.map((f) => f.text)).toEqual(["GuessSong", LOOP_QR_CAPTION]);
    for (const f of fills) expect(f.x).toBe(40);
  });
});
