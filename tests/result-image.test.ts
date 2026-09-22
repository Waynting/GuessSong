import { describe, it, expect } from "vitest";
import { LOOP_QR_CAPTION } from "@/lib/loop-links";
import { drawCardFooter, CARD_FOOTER_HEIGHT } from "@/lib/result-image";

/**
 * The footer of the result card: the one piece of the product that leaves
 * the party, drawn onto a canvas the suite does not have. The context is a
 * recorder — what matters is which strings land at which x, not pixels.
 *
 * The card carried a QR back to `/r/share` from 1.3.0 to 1.14.0, and the arm
 * read 0 followed of 94 shown over eleven weeks. This suite now pins the
 * opposite of what it used to: no image is drawn, and the "Scan to …" caption
 * never appears, because a scan line with nothing to scan is a lie printed
 * into a picture.
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
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    drawImage: (...args: unknown[]) => void drawn.push(args),
    fillText: (text: string, x: number, y: number) => void fills.push({ text, x, y }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, drawn };
}

describe("drawCardFooter", () => {
  it("prints the name and the bare address, both at the left margin, and draws no image", () => {
    const { ctx, fills, drawn } = recordingContext();
    drawCardFooter(ctx, 600, 100);

    expect(drawn).toHaveLength(0);
    expect(fills.map((f) => f.text)).toEqual(["GuessSong", "guessong.app"]);
    for (const f of fills) expect(f.x).toBe(40);
  });

  it("never prints the QR caption — there is nothing on the card to scan", () => {
    const { ctx, fills } = recordingContext();
    drawCardFooter(ctx, 600, 100);
    expect(fills.some((f) => f.text === LOOP_QR_CAPTION)).toBe(false);
  });

  it("is synchronous, so a card save cannot stall on a decoration", () => {
    // The QR footer was async because generating the code was; a caller
    // that forgets to await a sync function loses nothing, and one that
    // awaits it still works. Pinning the return type is what keeps a QR
    // from creeping back in behind an `await`.
    const { ctx } = recordingContext();
    expect(drawCardFooter(ctx, 600, 100)).toBeUndefined();
  });

  it("fits inside the band the callers reserve for it", () => {
    // Both card drawers size their canvas from CARD_FOOTER_HEIGHT and draw
    // the footer at the top of that band; the lowest baseline is the address.
    const { ctx, fills } = recordingContext();
    drawCardFooter(ctx, 600, 0);
    const lowest = Math.max(...fills.map((f) => f.y));
    expect(lowest).toBeLessThan(CARD_FOOTER_HEIGHT);
  });
});
