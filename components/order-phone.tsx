"use client";

/**
 * A player's own copy of a "put them in order" round, on `/buzz/[code]`.
 *
 * The host's page deals the round through the room without its years
 * (lib/order-phone.ts); this arranges the same cards with the same drag the
 * host's screen uses (`useCardDrag`), and locks in. A lock can be replaced
 * until the reveal, which arrives with the years and this seat's result.
 *
 * The arrangement is local until it is locked, and keyed by round: a new
 * deal starts from the dealt order, and a reconnect starts from the lock the
 * room handed back (`mine`), so a phone that slept through nothing loses
 * nothing it had sent.
 */

import { useState } from "react";
import type { OrderRoundView } from "@/lib/buzzer-protocol";
import { useCardDrag } from "@/lib/use-card-drag";

const ART_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231a1a1a'/%3E%3Ccircle cx='100' cy='100' r='40' fill='%23222'/%3E%3Ccircle cx='100' cy='100' r='10' fill='%23111'/%3E%3C/svg%3E";

export interface OrderPhoneProps {
  view: OrderRoundView;
  playerId: string;
  connected: boolean;
  onLock: (round: number, ids: string[]) => void;
}

export function OrderPhone({ view, playerId, connected, onLock }: OrderPhoneProps) {
  // Keyed by the round and the deal, so a re-deal of the same index (the
  // host's page reloaded) starts over rather than keeping ids that are gone.
  const dealKey = `${view.round}:${view.cards.map((c) => c.id).join(",")}`;
  const [local, setLocal] = useState<{ key: string; ids: string[] } | null>(null);
  const dealt = view.cards.map((c) => c.id);
  const ids = local?.key === dealKey ? local.ids : view.mine ?? dealt;
  const revealed = view.phase === "revealed" && view.reveal !== null;
  const lockedNow = view.mine !== null && view.mine.join(",") === ids.join(",");

  const cardDrag = useCardDrag(ids, !revealed, (next) => setLocal({ key: dealKey, ids: next }));
  const { drag } = cardDrag;

  const byId = new Map(view.cards.map((c) => [c.id, c]));
  const shown = revealed && view.reveal ? view.reveal.order : ids;
  // Where this phone had each card, for the marks at the reveal: the lock if
  // there was one, since that is what was graded.
  const answered = view.mine;
  const result = view.reveal?.results[playerId];

  return (
    <section className="flex flex-1 flex-col gap-3">
      <p className="px-1 text-center text-xs uppercase tracking-widest text-muted-foreground">
        {revealed ? "Oldest to newest — the real order" : "Oldest on top · drag into order"}
      </p>

      <div ref={cardDrag.listRef} role="list" className="flex flex-col gap-2">
        {shown.map((id, i) => {
          const card = byId.get(id);
          if (!card) return null;
          const lifted = drag?.id === id;
          const slot = answered ? answered.indexOf(id) : -1;
          const mark = revealed && answered ? (slot === i ? "right" : "wrong") : null;
          return (
            <div
              key={id}
              role="listitem"
              tabIndex={revealed ? undefined : 0}
              aria-label={revealed ? `${card.title}, rank ${i + 1}` : `${card.title}, position ${i + 1} of ${shown.length}. Arrow keys move it.`}
              onPointerDown={(e) => cardDrag.pickUp(e, id)}
              onPointerMove={cardDrag.dragMove}
              onPointerUp={cardDrag.putDown}
              onPointerCancel={cardDrag.putDown}
              onKeyDown={(e) => cardDrag.keyMove(e, id)}
              style={lifted ? { transform: `translateY(${drag.dy}px)` } : undefined}
              className={`flex min-w-0 items-center gap-3 rounded-xl border p-2 select-none ${
                revealed ? "" : "cursor-grab touch-none active:border-[#1DB954]"
              } ${
                lifted
                  ? "relative z-10 border-[#1DB954] bg-[#1c1c1c] shadow-xl"
                  : mark === "right"
                  ? "border-[#1DB954]/60 bg-[#1DB954]/10"
                  : mark === "wrong"
                  ? "border-red-500/35 bg-[#161616]"
                  : "border-[#262626] bg-[#161616]"
              }`}
            >
              <span className="w-5 shrink-0 text-center text-lg font-bold text-[#555]">
                {revealed ? i + 1 : String.fromCharCode(65 + dealt.indexOf(id))}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element -- remote album art, sized by CSS */}
              <img
                src={card.art || ART_PLACEHOLDER}
                alt=""
                draggable={false}
                className="pointer-events-none h-12 w-12 shrink-0 rounded-lg object-cover [-webkit-touch-callout:none]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{card.title}</p>
                <p className="truncate text-xs text-muted-foreground">{card.artist}</p>
              </div>
              {revealed && view.reveal && (
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-xl font-bold text-[#1DB954]">{view.reveal.years[id]}</span>
                  {mark === "wrong" && <span className="text-[11px] text-red-400">yours #{slot + 1}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {revealed ? (
        <p
          role="status"
          className={`rounded-xl p-3 text-center text-base font-semibold ${
            result && result.points > 0 ? "bg-[#1DB954]/15 text-[#1DB954]" : "bg-[#161616] text-muted-foreground"
          }`}
        >
          {!result || !result.locked
            ? "You didn't lock in this round"
            : result.verdict === "exact"
            ? `Every card right — +${result.points} pts`
            : result.verdict === "oldest"
            ? `Oldest song right — +${result.points} pt`
            : "Not this time"}
        </p>
      ) : (
        <>
          <button
            type="button"
            disabled={!connected || lockedNow}
            onClick={() => onLock(view.round, ids)}
            className="w-full rounded-xl bg-[#1DB954] py-4 text-lg font-bold text-[#04120a] transition-none active:scale-[0.98] disabled:bg-[#1a2a1a] disabled:text-[#8fd6a5]"
          >
            {lockedNow ? "Locked in ✓" : view.mine ? "Lock in again" : "Lock in"}
          </button>
          <p className="px-1 text-center text-xs text-muted-foreground">
            {lockedNow
              ? "You can still move a card and lock in again until the years go up."
              : view.mine
              ? "You moved a card since you locked in — lock in again to keep this order."
              : `${view.locked.length} locked in so far.`}
          </p>
        </>
      )}
    </section>
  );
}
