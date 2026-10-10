import type { Metadata } from "next";

// The same metadata as app/game/layout.tsx, for the same reasons: a game
// screen with no payload in the tab is a redirect, and the root layout's
// canonical would otherwise call it the home page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
