const ALERTS_KEY = "openspecs:alerts";

/** The one value that means yes. Anything else, absence included, means no. */
const ON = "on";

/**
 * How rarely the browser is allowed to knock. What arrives inside a closed
 * window is not dropped, it is counted, and the next knock says the count: five
 * reactions in a minute is one thing worth being told, not five.
 */
export const ALERT_GAP_MS = 30_000;

/** Every alert replaces the last in the tray rather than stacking beside it. */
const TAG = "openspecs";

/** Constant, so the operating system files them together under one heading. */
const TITLE = "Open Specs";

const store = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

const listeners = new Set<() => void>();

let wanted = false;
let read = false;

export const subscribeAlerts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => {
  for (const listener of listeners) listener();
};

/**
 * Whether this browser may knock when something arrives while you are elsewhere.
 *
 * Off unless asked for, like every other setting here. A page that asks the
 * browser for permission the moment it loads is a page asking for something
 * before it has anything to say, and the answer to that question can only be
 * given once.
 */
export const alertsWanted = (): boolean => {
  if (!read) {
    read = true;
    try {
      wanted = store()?.getItem(ALERTS_KEY) === ON;
    } catch {
      wanted = false;
    }
  }
  return wanted;
};

/** The server knocks on nobody's door, and its snapshot is what the page hydrates to. */
export const serverAlertsWanted = (): boolean => false;

export const setAlertsWanted = (on: boolean): void => {
  wanted = on;
  read = true;
  try {
    if (on) store()?.setItem(ALERTS_KEY, ON);
    else store()?.removeItem(ALERTS_KEY);
  } catch {}
  notify();
};

export type AlertPermission = "unsupported" | NotificationPermission;

/** `unsupported` where there is no such thing to permit, which is not a refusal. */
export const alertPermission = (): AlertPermission =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/**
 * Asked from a click and never from a page load. A browser that has refused is
 * not asked again: it would not show the prompt, and the setting says where to
 * change its mind instead.
 */
export const askToAlert = async (): Promise<AlertPermission> => {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
};

export type Alert = { body: string; path: string };

let pending: Alert[] = [];
let lastAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const knock = (alert: Alert): void => {
  try {
    const notification = new Notification(TITLE, {
      body: alert.body,
      tag: TAG,
      icon: "/apple-touch-icon.png",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      // A whole page load rather than a client side navigation. No context
      // reaches a router from here, and the tab this arrives at is in the
      // background, where a reload costs nobody anything.
      window.location.assign(alert.path);
    };
  } catch {
    // A browser that refuses to construct one has said no by other means.
  }
};

const flush = (): void => {
  timer = null;
  const held = pending;
  pending = [];
  if (held.length === 0) return;

  lastAt = Date.now();
  const only = held[0];
  if (held.length === 1 && only !== undefined) knock(only);
  else knock({ body: `${held.length} new notifications`, path: "/notifications" });
};

/**
 * One knock per window, carrying either what happened or how much of it did.
 * The caller decides whether anything should be knocked about at all; this only
 * decides how often.
 */
export const showAlert = (alert: Alert): void => {
  pending.push(alert);
  const since = Date.now() - lastAt;
  if (since >= ALERT_GAP_MS) {
    flush();
    return;
  }
  if (timer === null) timer = setTimeout(flush, ALERT_GAP_MS - since);
};

/** Test seam, and what a browser signing out has no more use for. */
export const clearAlerts = (): void => {
  pending = [];
  lastAt = 0;
  if (timer !== null) clearTimeout(timer);
  timer = null;
};
