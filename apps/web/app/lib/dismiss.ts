import { useEffect, useRef } from "react";

/**
 * The two ways out of a panel hung off a button: a pointer that lands anywhere
 * else, and Escape. Every panel on the web has them, and a panel whose only way
 * out is the control that opened it is one readers try to dismiss by clicking
 * the margin, twice, before giving up.
 *
 * Held only while something is open. Most readers open none of these, and they
 * should not pay a handler on every pointer that touches the page.
 *
 * Capturing, so that a panel holding something which stops propagation of its
 * own clicks cannot leave the page with a panel nothing closes.
 */
export const listenForDismissal = (
  stays: (target: EventTarget | null) => boolean,
  close: () => void,
): (() => void) => {
  if (typeof document === "undefined") return () => {};

  const onPointerDown = (event: Event): void => {
    if (!stays(event.target)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
};

/**
 * The same two ways out, for a panel that is one of many on a page rather than
 * one of the header's two: a document and every comment under it each carry one,
 * so there is no single name to key a shared store on. It answers for its own
 * subtree instead, through the ref it returns.
 *
 * Nothing coordinates these with each other, and nothing needs to: pressing one
 * panel's control is a pointer landing outside every other, so the one already
 * open closes on its own.
 */
export const useDismiss = <T extends HTMLElement>(
  open: boolean,
  close: () => void,
): React.RefObject<T | null> => {
  const holder = useRef<T>(null);
  // Read at dismissal rather than captured, so a close that changes on every
  // render does not let go of the page and take hold of it again each time.
  const latest = useRef(close);
  latest.current = close;

  useEffect(() => {
    if (!open) return;
    return listenForDismissal(
      (target) => target !== null && holder.current?.contains(target as Node) === true,
      () => latest.current(),
    );
  }, [open]);

  return holder;
};
