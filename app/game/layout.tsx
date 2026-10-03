import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Not the home page, which the root layout's canonical would say it is.
  alternates: { canonical: null },
};

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
