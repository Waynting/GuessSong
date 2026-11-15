/**
 * The solo invite card's words (`components/solo-invite.tsx`), per game.
 *
 * In `lib/` so the suite can pin them — vitest cannot import a `.tsx` module
 * here. English only, like both game pages. The body says what the game is
 * *with friends*, in the host-as-judge terms the product is built on: a person
 * who has only ever played alone has not seen that half, and "invite your
 * friends" without it is the share prompt that converted 0 of 94.
 */

export type SoloInviteGame = "guess" | "order";

export interface SoloInviteCopy {
  headline: string;
  body: string;
  button: string;
  /** Sent with the link into the chat; the recipient has never heard of the site. */
  shareText: string;
}

export const SOLO_INVITE_COPY: Record<SoloInviteGame, SoloInviteCopy> = {
  guess: {
    headline: "Better with friends",
    body: "Next time, put it on one phone: a clip plays, everyone shouts the song, you hand out the points.",
    button: "Send it to the group chat",
    shareText: "Let's play this next time we hang out: a clip plays, first to name the song wins. Free, no app.",
  },
  order: {
    headline: "Better with friends",
    body: "Next time, put it on one phone: everyone argues over which song came first, you hand out the points.",
    button: "Send it to the group chat",
    shareText: "Let's play this next time we hang out: put the songs in release order and argue about it. Free, no app.",
  },
};
