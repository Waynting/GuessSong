import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Play",
  description:
    "Learn how GuessSong works: paste any public Spotify playlist, add players, play short clips, and guess the song. Free, open source, no login required.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "How to Play | GuessSong",
    description:
      "Paste a Spotify playlist, play short clips, guess the song. Free, open source, no login required.",
  },
};

const GITHUB_URL = "https://github.com/Waynting/GuessSong";

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden>
      <path d="M12 2l2.955 6.09 6.72.885-4.914 4.665 1.233 6.66L12 17.085 6.006 20.3l1.233-6.66L2.325 8.975l6.72-.885L12 2z" />
    </svg>
  );
}

function WaveformBg() {
  const bars = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="waveform-wrap" aria-hidden>
      <div className="waveform-inner">
        {bars.map((i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{
              height: `${(20 + Math.sin(i * 0.4) * 15 + Math.sin(i * 0.9) * 20 + Math.cos(i * 0.7) * 15).toFixed(2)}%`,
              animationDelay: `${(i * 0.05) % 2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  {
    num: "01",
    title: "Paste a playlist",
    desc: "Grab the share link of any public Spotify playlist and drop it in. No Spotify login, no account — the game reads the track list for you.",
  },
  {
    num: "02",
    title: "Add your players",
    desc: "Type in everyone's name. GuessSong is a local party game: one screen, one host, everyone shouting answers at it.",
  },
  {
    num: "03",
    title: "Play the clip",
    desc: "The host hits play and a short clip (5–30 seconds, you choose) blasts out. No titles, no covers — just the music.",
  },
  {
    num: "04",
    title: "Guess & score",
    desc: "Everyone guesses out loud. The host taps whoever got it first — the scoreboard keeps track until a winner emerges.",
  },
];

const FEATURES = [
  {
    emoji: "🔓",
    title: "No login required",
    desc: "No Spotify account, no sign-up, no cookies-wall. Open the page and play.",
  },
  {
    emoji: "🎧",
    title: "Any public playlist",
    desc: "Your road-trip mix, K-pop hits, 80s classics — if it's a public Spotify playlist, it works.",
  },
  {
    emoji: "⚡",
    title: "Zero setup",
    desc: "Nothing to install, nothing stored on a server. All game state lives in your browser.",
  },
  {
    emoji: "🎚️",
    title: "Tune the difficulty",
    desc: "5-second clips for the pros, 30 seconds for a chill night. Pick how many songs each round runs.",
  },
  {
    emoji: "🔎",
    title: "Smart audio fallback",
    desc: "When Spotify has no preview for a track, GuessSong automatically finds one on iTunes or Deezer.",
  },
  {
    emoji: "🆓",
    title: "Free & open source",
    desc: "The whole thing is open code on GitHub. Fork it, remix it, host your own.",
  },
];

export default function AboutPage() {
  return (
    <>
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
          font-size: clamp(3rem, 9vw, 6.5rem);
          letter-spacing: 0.02em;
          line-height: 0.9;
          background: linear-gradient(135deg, #ffffff 0%, #aaffc8 40%, #1DB954 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .section-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(1.8rem, 4vw, 2.6rem);
          letter-spacing: 0.03em;
          line-height: 1;
          color: var(--text);
        }

        .eyebrow {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--green);
        }

        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
        }

        .cta-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          background: var(--green);
          color: #000;
          font-family: 'Outfit', sans-serif;
          font-size: 16px;
          font-weight: 700;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          letter-spacing: 0.03em;
          text-decoration: none;
          transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
          box-shadow: 0 4px 24px rgba(29,185,84,0.3);
        }
        .cta-primary:hover {
          background: #1ed760;
          box-shadow: 0 4px 32px rgba(29,185,84,0.5);
          transform: translateY(-1px);
        }

        .cta-secondary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          background: var(--surface2);
          color: var(--text);
          font-family: 'Outfit', sans-serif;
          font-size: 16px;
          font-weight: 600;
          border: 1.5px solid var(--border);
          border-radius: 12px;
          cursor: pointer;
          text-decoration: none;
          transition: border-color 0.15s, transform 0.1s, background 0.15s;
        }
        .cta-secondary:hover {
          border-color: var(--green);
          background: rgba(29,185,84,0.06);
          transform: translateY(-1px);
        }
        .cta-secondary .star-glyph { color: #ffd75e; display: inline-flex; }

        .step-card {
          display: flex;
          gap: 18px;
          align-items: flex-start;
          padding: 22px 24px;
        }
        .step-num {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 34px;
          line-height: 1;
          color: var(--green);
          opacity: 0.9;
          flex-shrink: 0;
          width: 44px;
        }
        .step-title {
          font-size: 17px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 6px;
        }
        .step-desc {
          font-size: 14px;
          color: #999;
          line-height: 1.6;
          font-weight: 300;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 12px;
        }
        .feature-card { padding: 20px; }
        .feature-emoji { font-size: 24px; margin-bottom: 10px; }
        .feature-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 6px;
        }
        .feature-desc {
          font-size: 13px;
          color: #999;
          line-height: 1.55;
          font-weight: 300;
        }

        .score-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
        }
        .score-pts {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          line-height: 1;
          color: var(--green);
          flex-shrink: 0;
          width: 58px;
        }
        .score-label { font-size: 14px; color: #ccc; line-height: 1.5; font-weight: 300; }
        .score-label strong { color: var(--text); font-weight: 600; }

        .star-banner {
          text-align: center;
          padding: 44px 28px;
          border: 1px solid rgba(29,185,84,0.25);
          border-radius: 20px;
          background:
            radial-gradient(ellipse at 50% -20%, rgba(29,185,84,0.12) 0%, transparent 60%),
            var(--surface);
        }

        .footer-link {
          color: var(--muted);
          text-decoration: none;
          transition: color 0.15s;
        }
        .footer-link:hover { color: var(--text); }

        .waveform-wrap {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .waveform-inner {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 256px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 3px;
          opacity: 0.06;
        }
        .waveform-bar {
          width: 3px;
          background: var(--green);
          border-radius: 2px 2px 0 0;
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

        .noise-overlay {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          opacity: 0.025;
        }
      `}</style>

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

      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "72px 20px 48px",
          position: "relative",
        }}
      >
        <div style={{ width: "100%", maxWidth: "760px", display: "flex", flexDirection: "column", gap: "72px" }}>
          {/* Hero */}
          <header className="fade-in fade-in-1" style={{ textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ color: "#1DB954", display: "inline-flex" }}>
                <SpotifyIcon />
              </span>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#777", letterSpacing: "0.08em" }}>
                OPEN SOURCE PARTY GAME
              </span>
            </div>
            <h1 className="hero-title">GuessSong</h1>
            <p style={{ color: "#999", fontSize: "17px", marginTop: "16px", fontWeight: 300, maxWidth: "520px", marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
              Turn any Spotify playlist into a party game. Play a short clip,
              let everyone guess the song, and crown the music champion of the room.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginTop: "28px" }}>
              <Link href="/" className="cta-primary">
                Play Now →
              </Link>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="cta-secondary">
                <span className="star-glyph"><StarIcon /></span>
                Star on GitHub
              </a>
            </div>
          </header>

          {/* How it works */}
          <section className="fade-in fade-in-2">
            <p className="eyebrow" style={{ marginBottom: "8px" }}>How it works</p>
            <h2 className="section-title" style={{ marginBottom: "24px" }}>From playlist to party in 30 seconds</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "12px" }}>
              {STEPS.map((step) => (
                <div key={step.num} className="card step-card">
                  <span className="step-num">{step.num}</span>
                  <div>
                    <p className="step-title">{step.title}</p>
                    <p className="step-desc">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Scoring */}
          <section className="fade-in fade-in-3">
            <p className="eyebrow" style={{ marginBottom: "8px" }}>Scoring</p>
            <h2 className="section-title" style={{ marginBottom: "12px" }}>The host is the judge</h2>
            <p style={{ color: "#999", fontSize: "14px", fontWeight: 300, lineHeight: 1.6, marginBottom: "20px", maxWidth: "560px" }}>
              No typing, no autocorrect arguments. Players shout their guesses,
              and the host taps the fastest correct answer on the scoreboard.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="card score-row">
                <span className="score-pts">+3</span>
                <span className="score-label">
                  <strong>Song title.</strong> First player to name the track takes the big points.
                </span>
              </div>
              <div className="card score-row">
                <span className="score-pts">+1</span>
                <span className="score-label">
                  <strong>Album name.</strong> A bonus for the true fans who know where the track lives.
                </span>
              </div>
            </div>
          </section>

          {/* Features */}
          <section className="fade-in fade-in-4">
            <p className="eyebrow" style={{ marginBottom: "8px" }}>Why GuessSong</p>
            <h2 className="section-title" style={{ marginBottom: "24px" }}>Built for game night, not for sign-ups</h2>
            <div className="feature-grid">
              {FEATURES.map((f) => (
                <div key={f.title} className="card feature-card">
                  <div className="feature-emoji" aria-hidden>{f.emoji}</div>
                  <p className="feature-title">{f.title}</p>
                  <p className="feature-desc">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Star CTA */}
          <section className="fade-in fade-in-5">
            <div className="star-banner">
              <div style={{ display: "inline-flex", color: "#ffd75e", marginBottom: "14px" }}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" aria-hidden>
                  <path d="M12 2l2.955 6.09 6.72.885-4.914 4.665 1.233 6.66L12 17.085 6.006 20.3l1.233-6.66L2.325 8.975l6.72-.885L12 2z" />
                </svg>
              </div>
              <h2 className="section-title" style={{ marginBottom: "10px" }}>Enjoying GuessSong?</h2>
              <p style={{ color: "#999", fontSize: "14px", fontWeight: 300, lineHeight: 1.6, maxWidth: "440px", margin: "0 auto 24px" }}>
                GuessSong is free and open source. If it made your game night better,
                a star on GitHub is the best way to say thanks — and it helps more
                people find the game.
              </p>
              <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="cta-primary">
                  <GitHubIcon size={18} />
                  Star on GitHub
                </a>
                <Link href="/" className="cta-secondary">
                  Start a game →
                </Link>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer style={{ textAlign: "center", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: "20px", justifyContent: "center", padding: "20px 0 4px", fontSize: "13px" }}>
              <Link href="/" className="footer-link">Play</Link>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-link" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <GitHubIcon size={14} />
                GitHub
              </a>
            </div>
            <p style={{ color: "#555", fontSize: "12px", fontWeight: 300 }}>
              Not affiliated with Spotify. Audio previews courtesy of iTunes & Deezer.
            </p>
          </footer>
        </div>
      </main>
    </>
  );
}
