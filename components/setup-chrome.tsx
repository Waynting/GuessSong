"use client";

/**
 * The shell the two setup pages share: `/` (the party game) and `/quiz` (the
 * Taste Quiz link). One stylesheet, one backdrop, the two icons both forms
 * draw.
 *
 * This used to be a 400-line `<style>` block inside `app/page.tsx` that
 * `RoomPanel`, `QuizPanel` and `MixedPlaylistCollector` all quietly depended
 * on for their class names — a component rendered anywhere else came out
 * unstyled, and nothing said why. Now the dependency is a named import: a
 * page that renders one of those panels renders `<SetupStyles />`, and the
 * class names are declared exactly once.
 *
 * A client module on purpose. `app/quiz/page.tsx` is a server component, and
 * a `<style>` rendered straight from one is serialised into the RSC payload
 * as well as the HTML — the whole stylesheet twice per cold load, on top of
 * the copy already in the shared JS chunk. As a client component the payload
 * carries a module reference, and the JS copy is the one `/` has cached.
 */

export function SetupStyles() {
  return (
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');

        :root {
          --green: #1DB954;
          --green-dim: #169c44;
          --bg: #111111;
          --surface: #1a1a1a;
          --surface2: #222222;
          --border: #2a2a2a;
          --text: #f0f0f0;
          --muted: #777;
        }

        body { background: var(--bg); font-family: 'Outfit', sans-serif; color: var(--text); }

        .hero-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(2.8rem, 8vw, 6rem);
          letter-spacing: 0.02em;
          line-height: 0.9;
          background: linear-gradient(135deg, #ffffff 0%, #aaffc8 40%, #1DB954 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: none;
        }

        /* The hero's one link. A language switch in the corner, not a
           slogan under the title: the crawl path to /zh is the href, and
           the form is what the page is for. */
        .lang-switch {
          position: absolute;
          top: 0;
          right: 0;
          font-size: 12px;
          color: #888;
          text-decoration: none;
          padding: 8px 10px;
          min-height: 32px;
          display: inline-flex;
          align-items: center;
          border-radius: 6px;
          transition: color 0.15s, background 0.15s;
        }
        .lang-switch:hover { color: var(--text); background: rgba(255,255,255,0.05); }
        .lang-switch:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

        /* A link that is a button: mode switches and the settings toggle.
           Text only, so it never competes with a pill or the Start button. */
        .text-link {
          background: none;
          border: none;
          /* Text-sized on screen, thumb-sized to tap: the padding grows the
             hit area to ~32px and the negative margin gives the space back. */
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 6px 4px;
          margin: -6px -4px;
          border-radius: 4px;
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--green);
          cursor: pointer;
          text-decoration: none;
          transition: color 0.15s;
        }
        .text-link:hover { color: #1ed760; text-decoration: underline; text-underline-offset: 3px; }
        .text-link:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

        .settings-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .settings-summary {
          font-size: 13px;
          color: #999;
          font-weight: 400;
        }

        /* Under the Start button: what the button is waiting for. It used
           to be written on the button itself, in eight different labels. */
        .start-status {
          margin-top: 10px;
          font-size: 13px;
          color: #999;
          text-align: center;
        }

        .mode-links {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          gap: 6px 14px;
          margin-top: 18px;
        }
        .mode-links .text-link { color: #999; }
        .mode-links .text-link:hover { color: var(--green); }
        .mode-links-sep { color: #444; font-size: 12px; }

        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
        }

        .url-input {
          width: 100%;
          background: var(--surface2);
          border: 1.5px solid var(--border);
          border-radius: 10px;
          padding: 14px 48px 14px 16px;
          font-size: 15px;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }
        .url-input:focus {
          border-color: var(--green);
          box-shadow: 0 0 0 3px rgba(29,185,84,0.12);
        }
        .url-input.valid { border-color: var(--green); }
        .url-input::placeholder { color: var(--muted); }

        .player-input {
          flex: 1;
          background: var(--surface2);
          border: 1.5px solid var(--border);
          border-radius: 8px;
          padding: 11px 14px;
          font-size: 14px;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          outline: none;
          transition: border-color 0.2s;
        }
        .player-input:focus { border-color: var(--green); }
        .player-input::placeholder { color: var(--muted); }

        .pill {
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
          border: 1.5px solid var(--border);
          background: var(--surface2);
          color: var(--muted);
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Outfit', sans-serif;
        }
        .pill:hover { border-color: #444; color: var(--text); }
        .pill.active {
          background: var(--green);
          border-color: var(--green);
          color: #000;
          box-shadow: 0 0 16px rgba(29,185,84,0.4);
        }

        /* Same pill, but a field. The spinners are hidden because they are the
           wrong affordance at this size and clip the text inside the radius. */
        .count-input {
          width: 92px;
          text-align: center;
          color: var(--text);
          -moz-appearance: textfield;
        }
        .count-input::-webkit-outer-spin-button,
        .count-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .count-input:focus {
          outline: none;
          border-color: var(--green);
        }
        .count-input::placeholder { color: var(--muted); font-weight: 600; }
        /* Selected reads the same here as on a pill. Without it a committed
           custom count is dark text in a dark field while every preset lights
           up green, so the row looks like nothing is chosen. */
        .count-input.active { color: #000; }
        .count-input.active::placeholder { color: rgba(0,0,0,0.45); }
        /* A phone. The card's inner width is the viewport less 98px of
           padding and border — 277px at 375, 262px at 360 — and the quiz's
           count row (four pills, the typed field, four 8px gaps) is ~294px at
           the sizes above, so the field wrapped to a row of its own. Three
           pixels off each pill side and a narrower field bring the row to
           ~257px: it fits at 360 with a few pixels to spare, and "Custom",
           the widest placeholder, still clears the field's padding. The
           Number of Songs row has one more pill and wraps either way; it is
           unchanged in shape. */
        @media (max-width: 420px) {
          .pill { padding: 8px 9px; }
          .count-input { width: 76px; padding-left: 8px; padding-right: 8px; }
        }

        .link-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 999px;
          border: 1.5px solid rgba(29,185,84,0.35);
          background: rgba(29,185,84,0.06);
          color: var(--green);
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          /* The footer's "What's new" is a <button> in the same row as the
             mailto <a>. Buttons don't inherit either of these. */
          cursor: pointer;
          line-height: 1.2;
          transition: border-color 0.15s, background 0.15s, transform 0.1s;
        }
        .link-btn:hover {
          border-color: var(--green);
          background: rgba(29,185,84,0.12);
          transform: translateY(-1px);
        }

        .start-btn {
          width: 100%;
          padding: 16px;
          background: var(--green);
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 18px;
          font-weight: 700;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          letter-spacing: 0.03em;
          transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
          box-shadow: 0 4px 24px rgba(29,185,84,0.3);
        }
        .start-btn:hover:not(:disabled) {
          background: #1ed760;
          box-shadow: 0 4px 32px rgba(29,185,84,0.5);
          transform: translateY(-1px);
        }
        .start-btn:active:not(:disabled) { transform: translateY(0); }
        .start-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .add-player-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 500;
          color: var(--green);
          background: none;
          border: 1.5px dashed rgba(29,185,84,0.4);
          border-radius: 8px;
          padding: 9px 16px;
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Outfit', sans-serif;
          width: 100%;
          justify-content: center;
        }
        .add-player-btn:hover {
          border-color: var(--green);
          background: rgba(29,185,84,0.05);
        }

        .remove-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--muted);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .remove-btn:hover { background: #3a1a1a; border-color: #662222; color: #ef4444; }

        .section-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 10px;
        }

        /* Crawlable prose. The setup form above is almost entirely UI chrome,
           so without this the homepage has nothing for Google to match a
           query like "guess the song game" against. */
        .seo-section { margin-top: 44px; }
        .seo-h2 {
          font-size: 15px;
          font-weight: 600;
          color: #999;
          margin-bottom: 10px;
        }
        .seo-p {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.7;
          color: #666;
        }
        .seo-p + .seo-p { margin-top: 10px; }
        .guide-links {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 10px;
        }
        .guide-link {
          display: block;
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 14px 16px;
          text-decoration: none;
          transition: border-color 0.15s ease;
        }
        .guide-link:hover { border-color: #1DB954; }
        .guide-link-title {
          color: #f0f0f0;
          font-size: 14.5px;
          font-weight: 600;
          line-height: 1.4;
          margin-bottom: 4px;
        }
        .guide-link-desc {
          color: #888;
          font-size: 12.5px;
          font-weight: 300;
          line-height: 1.5;
        }
        .faq-list { margin-top: 12px; display: flex; flex-direction: column; gap: 14px; }
        .faq-q {
          font-size: 13px;
          font-weight: 500;
          color: #999;
          margin-bottom: 4px;
        }
        .faq-a {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.7;
          color: #666;
        }
        .faq-a a { color: #1DB954; }
        .faq-a a:hover { text-decoration: underline; }

        .waveform-bar {
          animation: waveform 2.4s ease-in-out infinite alternate;
        }
        @keyframes waveform {
          from { transform: scaleY(0.4); }
          to { transform: scaleY(1); }
        }

        .fade-in {
          opacity: 0;
          transform: translateY(16px);
          animation: fadeUp 0.5s ease forwards;
        }
        .fade-in-1 { animation-delay: 0.05s; }
        .fade-in-2 { animation-delay: 0.15s; }
        .fade-in-3 { animation-delay: 0.25s; }
        .fade-in-4 { animation-delay: 0.35s; }
        .fade-in-5 { animation-delay: 0.45s; }
        @keyframes fadeUp {
          to { opacity: 1; transform: translateY(0); }
        }

        .dot-pulse::after {
          content: '...';
          animation: dots 1.2s steps(4, end) infinite;
        }
        @keyframes dots {
          0%, 20% { content: ''; }
          40% { content: '.'; }
          60% { content: '..'; }
          80%, 100% { content: '...'; }
        }

        .spinner {
          width: 20px; height: 20px;
          border: 2.5px solid rgba(0,0,0,0.3);
          border-top-color: #000;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: inline-block;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .noise-overlay {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          opacity: 0.025;
        }
      `}</style>
  );
}

export function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WaveformBg() {
  const bars = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      <div className="absolute bottom-0 left-0 right-0 h-64 flex items-end justify-center gap-[3px] opacity-[0.06]">
        {bars.map((i) => (
          <div
            key={i}
            className="waveform-bar bg-[#1DB954] rounded-t-sm"
            style={{
              width: "3px",
              height: `${(20 + Math.sin(i * 0.4) * 15 + Math.sin(i * 0.9) * 20 + Math.cos(i * 0.7) * 15).toFixed(2)}%`,
              animationDelay: `${(i * 0.05) % 2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** The noise, the waveform and the glow — fixed, behind everything. */
export function SetupBackdrop() {
  return (
    <>
      <div className="noise-overlay" aria-hidden />
      <WaveformBg />

      {/* Radial glow top-center */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "-20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "400px",
          background: "radial-gradient(ellipse at center, rgba(29,185,84,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
    </>
  );
}
