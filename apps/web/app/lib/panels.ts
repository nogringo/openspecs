/**
 * Which of the header's panels is open, of the one at most that can be.
 *
 * It is a module rather than state inside each panel because the question
 * belongs to the pair: opening one has to close the other, and neither of them
 * can answer that on its own. The two ways out come from `dismiss`, which every
 * panel on this site hangs off whether it is one of these or one of the many a
 * document's page carries.
 *
 * Both panels mark themselves and their control with `data-panel`, which is how
 * a click that lands inside one is told from a click that lands outside.
 */

import { listenForDismissal } from "./dismiss";

/** Named here rather than in each panel, so the two cannot drift or collide. */
export type PanelName = "notifications" | "identity";

const INSIDE_A_PANEL = "[data-panel]";

let shown: PanelName | null = null;
const listeners = new Set<() => void>();

export const subscribePanels = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** Duck typed rather than `instanceof Element`, which is not a thing everywhere. */
const insideAPanel = (target: EventTarget | null): boolean => {
  if (target === null || !("closest" in target)) return false;
  return (target as Element).closest(INSIDE_A_PANEL) !== null;
};

let stopListening: (() => void) | null = null;

const listen = (on: boolean): void => {
  if (on) stopListening = listenForDismissal(insideAPanel, closePanels);
  else if (stopListening !== null) {
    stopListening();
    stopListening = null;
  }
};

const show = (next: PanelName | null): void => {
  if (next === shown) return;
  const had = shown !== null;
  shown = next;
  if (next !== null && !had) listen(true);
  else if (next === null && had) listen(false);
  notify();
};

export const openPanel = (name: PanelName): void => show(name);
export const closePanels = (): void => show(null);
export const togglePanel = (name: PanelName): void => show(shown === name ? null : name);

/**
 * Closes one only if it is the one open, which is what a panel leaving the page
 * means. The header is rendered inside each route, so both are unmounted and
 * mounted again on every navigation, and an open panel that outlived that would
 * open itself again on the page it was never opened on.
 */
export const closePanel = (name: PanelName): void => show(shown === name ? null : shown);

export const panelState = (): PanelName | null => shown;

/** The server opens nothing, and its snapshot is what the page hydrates to. */
export const serverPanelState = (): PanelName | null => null;
