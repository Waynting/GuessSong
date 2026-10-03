import type { Metadata } from "next";

/**
 * /share is ephemeral or a hand-off, and already in robots.ts's disallow list.
 * That keeps crawlers out but says nothing about the page itself, which
 * otherwise inherits the root layout's `index, follow` and a canonical
 * naming the home page — a self-contradiction for any crawler that reaches it
 * by another route. Same rule as app/game/layout.tsx and app/q/layout.tsx.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
