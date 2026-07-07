"use client";

/**
 * PWA plumbing: service worker registration and deferred install prompt.
 *
 * Chrome fires `beforeinstallprompt` early in the page lifecycle; we stash it
 * (instead of prompting immediately) so the game can trigger the install
 * prompt at a high-intent moment — the game-over screen. Module-level state
 * is fine here: init runs once from <PwaSetup /> in the root layout, and the
 * game page reads it through canInstall()/promptInstall().
 */

import { trackEvent } from "@/lib/analytics";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;

export function initPwa(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Event fired before hydration? The inline bip-capture script in
  // app/layout.tsx stashed it for us.
  const early = (window as { __bipEvent?: BeforeInstallPromptEvent }).__bipEvent;
  if (early) {
    deferredPrompt = early;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: the site works without a SW, it's only needed for install.
    });
  }
}

export function isStandalone(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/** True when the browser has offered installability and we can prompt. */
export function canInstall(): boolean {
  return deferredPrompt !== null && !isStandalone();
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  if (!deferredPrompt) return null;
  const prompt = deferredPrompt;
  deferredPrompt = null; // prompt() can only be called once per event
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  trackEvent("pwa_install_prompt", { outcome });
  return outcome;
}
