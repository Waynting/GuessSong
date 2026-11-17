import type { Metadata } from "next";
import { SetupPage } from "../setup-page";

/**
 * The setup page in Brazilian Portuguese — an internal route, not a page of
 * its own in search.
 *
 * Nobody is meant to arrive at `/pt` by name: `middleware.ts` rewrites `/` to
 * it, keeping the address `/`, when the reader's top Accept-Language is
 * Portuguese. It is prerendered like `/` (the language is a prop, decided at
 * build time), so the rewrite serves a static file and the HTML is Portuguese
 * from the first byte — no English flash, which is what kept the full-site
 * localisation in `docs/decisions.md` rejected.
 *
 * `noindex` with the canonical on `/`: it must never compete with `/` for the
 * English phrase `/` ranks for. `follow` stays on so the links it carries
 * still count. Not in `app/robots.ts`'s disallow list, because a crawler that
 * cannot fetch the page cannot read the `noindex` either.
 */
export const metadata: Metadata = {
  title: { absolute: "Adivinhe a música — jogo de festa grátis com playlists do Spotify | GuessSong" },
  description:
    "Toque um trecho e adivinhe a música. O GuessSong é um jogo gratuito que transforma qualquer playlist do Spotify num quiz musical para festas — sem login, sem app, sem cadastro.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/" },
};

export default function SetupPagePt() {
  return <SetupPage locale="pt" />;
}
