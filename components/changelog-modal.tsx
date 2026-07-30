"use client";

/**
 * The footer's "What's new" button and the overlay it opens.
 *
 * An overlay rather than a `/changelog` route on purpose: release notes are a
 * detour, not a destination. A page would take a host out of a half-configured
 * setup form — the state of which lives in React and does not survive a
 * navigation — and would want indexing, sitemap and hreflang entries for content
 * that has no search value.
 *
 * The overlay renders into `document.body` through a portal. The footer sits
 * inside the homepage's `.fade-in` containers, whose finished animation leaves a
 * non-`none` transform behind; that makes them the containing block for
 * `position: fixed` descendants, so an inline overlay would be clipped to the
 * footer instead of covering the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trackEvent } from "@/lib/analytics";
import {
  CHANGELOG,
  CHANGELOG_UI,
  LATEST_VERSION,
  changeText,
  entryHeadline,
  formatChangelogDate,
  type ChangeKind,
  type ChangelogLocale,
} from "@/lib/changelog";

const KIND_STYLE: Record<ChangeKind, { color: string; background: string }> = {
  new: { color: "#8fd6a5", background: "#14331f" },
  better: { color: "#9ec5fe", background: "#16202e" },
  fixed: { color: "#aaa", background: "#242424" },
};

export interface ChangelogModalProps {
  /** Matches the sibling footer links by default. */
  className?: string;
  /** Which language the trigger and the notes render in. `/zh` passes "zh". */
  locale?: ChangelogLocale;
  /** Overrides the locale's default trigger text. */
  label?: string;
}

export function ChangelogModal({
  className = "link-btn",
  locale = "en",
  label,
}: ChangelogModalProps) {
  const ui = CHANGELOG_UI[locale];
  // The label width has to be stable across the badge column, so the kind
  // badges are sized from the longest label in whichever language is rendering.
  const badgeMinWidth = locale === "zh" ? "40px" : "54px";
  const [open, setOpen] = useState(false);
  // Portals need a DOM to render into, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    // Send focus back where it came from, so a keyboard reader isn't dropped at
    // the top of the document.
    triggerRef.current?.focus();
  }, []);

  function handleOpen() {
    setOpen(true);
    trackEvent("changelog_opened", { version: LATEST_VERSION });
  }

  useEffect(() => {
    if (!open) return;

    // The overlay scrolls its own content; letting the page scroll behind it
    // means a flick on mobile moves the wrong thing.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside the dialog. Without this, tabbing walks into the page
      // behind an overlay that is still covering it.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={handleOpen}
        aria-haspopup="dialog"
      >
        {label ?? ui.trigger}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="cl-backdrop"
            role="presentation"
            onClick={close}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              background: "rgba(0,0,0,0.72)",
              backdropFilter: "blur(3px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              animation: "cl-fade 0.15s ease-out",
            }}
          >
            <style>{`
              @keyframes cl-fade { from { opacity: 0 } to { opacity: 1 } }
              @keyframes cl-rise {
                from { opacity: 0; transform: translateY(12px) }
                to { opacity: 1; transform: translateY(0) }
              }
              .cl-scroll::-webkit-scrollbar { width: 8px }
              .cl-scroll::-webkit-scrollbar-thumb {
                background: #333; border-radius: 999px;
              }
              @media (prefers-reduced-motion: reduce) {
                .cl-panel, .cl-backdrop { animation: none !important }
              }
            `}</style>
            <div
              ref={dialogRef}
              className="cl-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="changelog-title"
              tabIndex={-1}
              // A click inside the panel must not reach the backdrop's close
              // handler, or selecting text would dismiss the overlay.
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: "560px",
                maxHeight: "min(80vh, 720px)",
                display: "flex",
                flexDirection: "column",
                background: "#1a1a1a",
                border: "1px solid #2a2a2a",
                borderRadius: "12px",
                outline: "none",
                animation: "cl-rise 0.2s ease-out",
                boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "20px 20px 14px",
                  borderBottom: "1px solid #2a2a2a",
                }}
              >
                <div>
                  <h2
                    id="changelog-title"
                    style={{
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: "26px",
                      letterSpacing: "0.06em",
                      color: "#f0f0f0",
                      lineHeight: 1.1,
                    }}
                  >
                    {ui.title}
                  </h2>
                  <p style={{ fontSize: "12px", color: "#777", marginTop: "2px" }}>
                    {ui.currentVersion}
                    {LATEST_VERSION}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label={ui.close}
                  style={{
                    flexShrink: 0,
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    border: "1px solid #2a2a2a",
                    background: "#222",
                    color: "#999",
                    fontSize: "16px",
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              <div
                className="cl-scroll"
                style={{ overflowY: "auto", padding: "4px 20px 20px" }}
              >
                {CHANGELOG.map((entry) => (
                  <section key={entry.version} style={{ marginTop: "20px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontSize: "19px",
                          letterSpacing: "0.06em",
                          color: "#1DB954",
                        }}
                      >
                        v{entry.version}
                      </span>
                      <span style={{ fontSize: "11px", color: "#666" }}>
                        {formatChangelogDate(entry.date, locale)}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#bbb",
                        margin: "2px 0 12px",
                        lineHeight: 1.5,
                      }}
                    >
                      {entryHeadline(entry, locale)}
                    </p>
                    <ul
                      style={{
                        listStyle: "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      {entry.changes.map((change) => (
                        <li
                          key={change.text}
                          style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              marginTop: "1px",
                              fontSize: "10px",
                              fontWeight: 600,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              padding: "3px 7px",
                              borderRadius: "999px",
                              minWidth: badgeMinWidth,
                              textAlign: "center",
                              ...KIND_STYLE[change.kind],
                            }}
                          >
                            {ui.kinds[change.kind]}
                          </span>
                          <span
                            style={{ fontSize: "13.5px", color: "#ddd", lineHeight: 1.55 }}
                          >
                            {changeText(change, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}

                <p
                  style={{
                    fontSize: "11.5px",
                    color: "#555",
                    marginTop: "22px",
                    paddingTop: "14px",
                    borderTop: "1px solid #222",
                    lineHeight: 1.5,
                  }}
                >
                  {ui.footnotePrefix}
                  <code style={{ color: "#777" }}>CHANGELOG.md</code>
                  {ui.footnoteSuffix}
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
