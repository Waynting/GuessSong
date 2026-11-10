/**
 * The grip on a face-down "put them in order" card: six dots in a 10×16
 * column, the one glyph on the screen that says "this can be picked up".
 *
 * An inline SVG and not a text glyph (⋮⋮): a character falls back to a
 * system font with different metrics on every OS, and the card is sized to
 * the pixel on a 390px phone. `currentColor`, so each screen sets the colour
 * — `#666` at rest, the green while the card is lifted — in its own CSS or
 * Tailwind class. `aria-hidden`: the card itself carries the label and the
 * arrow-key instructions, and a decorative glyph read aloud is noise.
 *
 * Rendered by both card lists, the host's (`app/order/page.tsx`) and the
 * phone's (`components/order-phone.tsx`), which share `useCardDrag` for the
 * same reason: one implementation, or a phone whose cards stop matching the
 * host's. Sits at the trailing edge, where the year appears at the reveal,
 * so a card is the same width face down and face up and the title column
 * loses nothing.
 */
export function CardGrip({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `card-grip ${className}` : "card-grip"}
      width="10"
      height="16"
      viewBox="0 0 10 16"
      aria-hidden="true"
      focusable="false"
    >
      {[2, 8, 14].flatMap((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" />)
      )}
    </svg>
  );
}
