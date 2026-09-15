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

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CHANGELOG_UI, type ChangelogLocale } from "@/lib/changelog-ui";

// The overlay — and every release note with it — arrives on the first tap.
// Never server-rendered: it only exists while `open` is true. A chunk that
// never arrives (a tab from before a deploy asking for a hash that is gone)
// gets one line under the button, not the route's crash screen: a host
// mid-setup who taps "What's new" must not lose the form over release notes.
const ChangelogDialog = dynamic(
  () =>
    import("@/components/changelog-dialog")
      .then((m) => m.ChangelogDialog)
      .catch(() => ChangelogUnavailable),
  { ssr: false }
);

function ChangelogUnavailable() {
  return (
    <p role="alert" style={{ fontSize: "12px", color: "#999", marginTop: "8px" }}>
      Couldn&apos;t load the notes — reload the page to read them.
    </p>
  );
}

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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Send focus back where it came from, so a keyboard reader isn't dropped at
    // the top of the document.
    triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {label ?? ui.trigger}
      </button>

      {open && <ChangelogDialog locale={locale} onClose={close} />}
    </>
  );
}
