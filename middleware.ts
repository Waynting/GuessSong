import { NextResponse, type NextRequest } from "next/server";
import { rootLocaleFor } from "@/lib/accept-language";

/**
 * `/` in Portuguese, without a redirect and without an English flash.
 *
 * Brazil became the largest market in the traffic wave from 2026-11-11, and
 * the setup page was English only. `/` is prerendered and must stay that way,
 * so the language cannot be decided in the page; it is decided here, before
 * the static file is chosen. A reader whose top Accept-Language is Portuguese
 * is served `/pt` — a second prerendered copy of the same form — under the
 * address `/`. Everyone else, Googlebot included, passes straight through to
 * today's `/`.
 *
 * Three rules hold it together:
 *
 *   - **The matcher is `/` and nothing else.** Middleware runs on every
 *     request it matches; the share target (`/share` → `/?playlist=…`), the
 *     game pages, the API and every asset must not pay for a header read
 *     they have no use for. The `/` the share target redirects to does pass
 *     through here, query intact, which is what a Portuguese host sharing a
 *     playlist from Spotify should get.
 *   - **A rewrite, never a redirect.** A redirect is a second round trip on
 *     the page that takes nearly all of the site's traffic, and would put
 *     `/pt` in the address bar, in shared links and in Google's view of `/`.
 *   - **`Vary: Accept-Language` on both branches.** The same URL now has two
 *     bodies; a shared cache that kept one would hand English to Brazil or
 *     Portuguese to everyone. The English branch needs it as much as the
 *     Portuguese one. (Under `next start` Next 15.5's app-page handler
 *     overwrites `Vary` on the way out; whether Vercel keeps this one is
 *     unverified — see CLAUDE.md, "`/` has a Portuguese twin".)
 *
 * `next.config.js`'s redirects for `/?mode=quiz` and `/?ref=quiz_result` run
 * before this, so those still land on `/quiz`.
 */
export function middleware(request: NextRequest) {
  const locale = rootLocaleFor(request.headers.get("accept-language"));
  const response =
    locale === "pt"
      ? NextResponse.rewrite(withPath(request, "/pt"))
      : NextResponse.next();
  response.headers.set("Vary", "Accept-Language");
  return response;
}

/** The request's URL with another path and its query kept (`?playlist=`, `?ref=`). */
function withPath(request: NextRequest, pathname: string): URL {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return url;
}

export const config = {
  matcher: ["/"],
};
