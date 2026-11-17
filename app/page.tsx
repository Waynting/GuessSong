import { SetupPage } from "./setup-page";

/**
 * `/`, in English — the page Google ranks and nearly all traffic lands on.
 *
 * The form itself is `app/setup-page.tsx`, shared with `app/pt/page.tsx`,
 * which `middleware.ts` serves at this same URL to a reader whose top
 * Accept-Language is Portuguese. This file stays a server component with no
 * metadata of its own: the canonical and the hreflang set live in
 * `app/layout.tsx`, and the route must stay prerendered (○ in the build's
 * route table) — a request-time read here would make every visit a function
 * invocation on the page that takes almost all of the site's traffic.
 */
export default function Home() {
  return <SetupPage locale="en" />;
}
