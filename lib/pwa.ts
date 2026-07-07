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
const listeners = new Set<(available: boolean) => void>();

function notify(): void {
  const available = canInstall();
  listeners.forEach((cb) => cb(available));
}

/**
 * Subscribe to install availability. Fires immediately with the current
 * state, then again whenever it changes (beforeinstallprompt can arrive
 * well after a page mounts). Returns an unsubscribe function.
 */
export function subscribeInstall(
  cb: (available: boolean) => void
): () => void {
  listeners.add(cb);
  cb(canInstall());
  return () => {
    listeners.delete(cb);
  };
}

export function initPwa(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
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
  notify();
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  trackEvent("pwa_install_prompt", { outcome });
  return outcome;
}
