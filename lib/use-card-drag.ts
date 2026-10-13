"use client";

/**
 * Drag four cards into order, by pointer or by arrow key — the one
 * implementation the order game's two screens share: the host's
 * (`app/order/page.tsx`) and each player's phone (`components/order-phone.tsx`).
 *
 * Written once because the two drifting apart is a phone whose card does not
 * follow the finger while the host's does, and nothing on either screen would
 * say which one was right. The arithmetic (`moveCard`, `dropSlot`) is in
 * lib/order-game.ts and tested there; this is the pointer wiring around it.
 *
 * No library. The slots' centres are measured once when a card is picked up;
 * the card follows the pointer, and when its centre is nearer another slot
 * the list reorders under it and the offset is re-based on the new slot, so
 * the card stays under the finger. The list element (`listRef`) must hold the
 * cards as its direct children, top to bottom.
 */

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { dropSlot, moveCard } from "@/lib/order-game";

export interface CardDrag {
  listRef: RefObject<HTMLDivElement>;
  /** The card under a finger, and how far it sits from its slot. */
  drag: { id: string; dy: number } | null;
  pickUp: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  dragMove: (event: ReactPointerEvent<HTMLElement>) => void;
  putDown: () => void;
  /** Arrow keys shift the focused card one slot. */
  keyMove: (event: ReactKeyboardEvent<HTMLElement>, id: string) => void;
  /** Drop whatever is held without moving it — the reveal arriving mid-drag. */
  cancel: () => void;
}

/**
 * `ids` is the arrangement as rendered; `onMove` gets the new one. `enabled`
 * false makes every handler a no-op (the years are up, or the answer is in).
 */
export function useCardDrag(
  ids: readonly string[],
  enabled: boolean,
  onMove: (ids: string[]) => void
): CardDrag {
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const dragRef = useRef<{ id: string; startY: number; origin: number; centres: number[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function pickUp(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (!enabled || !listRef.current) return;
    const index = ids.indexOf(id);
    if (index < 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const centres = Array.from(listRef.current.children).map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    dragRef.current = { id, startY: event.clientY, origin: centres[index], centres };
    setDrag({ id, dy: 0 });
  }

  function dragMove(event: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d) return;
    const centre = d.origin + (event.clientY - d.startY);
    const from = ids.indexOf(d.id);
    const to = dropSlot(centre, d.centres);
    if (from >= 0 && to !== from) onMove(moveCard(ids, from, to));
    setDrag({ id: d.id, dy: centre - d.centres[to] });
  }

  function putDown() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDrag(null);
  }

  function keyMove(event: ReactKeyboardEvent<HTMLElement>, id: string) {
    if (!enabled) return;
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = ids.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) return;
    onMove(moveCard(ids, from, to));
  }

  function cancel() {
    dragRef.current = null;
    setDrag(null);
  }

  return { listRef, drag, pickUp, dragMove, putDown, keyMove, cancel };
}
