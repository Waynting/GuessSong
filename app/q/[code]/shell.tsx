/**
 * The full-height page frame both quiz pages sit in, carrying the site's
 * identity onto `/q`.
 *
 * The first version was a shadcn `Card` in the system font, which read as a
 * form and as a different product from the page that made the link. This
 * loads the same two faces the setup page does and paints the same `#111`, so
 * a friend who opens the link and the host who made it are looking at one
 * thing. `.q-display` is the display face for anything that wants it; body
 * text inherits Outfit.
 *
 * `100dvh` with a `100vh` fallback: the duel fills the viewport, and on a
 * phone `100vh` is the viewport with the browser chrome hidden, which puts the
 * lower half under the toolbar. Safe-area insets keep the seam and the back
 * link off the home indicator. Reduced motion switches every transition and
 * animation below this frame off at once.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="q-shell">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');

        html, body { background: #111; }
        body { font-family: 'Outfit', sans-serif; color: #f0f0f0; }

        .q-shell {
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          background: #111;
          color: #f0f0f0;
          padding:
            calc(14px + env(safe-area-inset-top))
            calc(16px + env(safe-area-inset-right))
            calc(14px + env(safe-area-inset-bottom))
            calc(16px + env(safe-area-inset-left));
          overflow-x: hidden;
        }
        .q-display {
          font-family: 'Bebas Neue', sans-serif;
          letter-spacing: 0.02em;
          line-height: 0.95;
          /* Bebas Neue has no CJK glyphs, so 好好先生 falls to the system sans
             — at 400 it read a weight lighter than the Latin titles beside it.
             Ask for 700 and forbid synthesis: the fallback has a real bold and
             uses it; Bebas has only 400 and stays as drawn. */
          font-weight: 700;
          font-synthesis: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .q-shell *, .q-shell *::before, .q-shell *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
      {children}
    </main>
  );
}
