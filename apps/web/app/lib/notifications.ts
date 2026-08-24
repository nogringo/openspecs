import type { NostrEvent, Notice, Subscription } from "@openspecs/nostr";
import { markSeen, noteKey, seenAt, unreadCount } from "./seen";

export type NoticesStatus = "idle" | "loading" | "ready";

export type NoticesState = {
  /** Whose news this is, so no page ever draws one key another key's mail. */
  me: string | null;
  status: NoticesStatus;
  notices: Notice[];
  /** The mark these are read against, which is what a row is drawn unread by. */
  seenAt: number;
  /** How many arrived since this browser last showed them to this key. */
  unread: number;
};

export const NO_NOTICES: NoticesState = Object.freeze({
  me: null,
  status: "idle",
  notices: [],
  seenAt: 0,
  unread: 0,
});

/** Often enough to watch news arrive, rarely enough not to re-sort on every event. */
const NOTIFY_MS = 150;

let state = NO_NOTICES;
let me: string | null = null;
/** The relays have listed what they hold. Not that events stopped arriving. */
let listed = false;
let events = new Map<string, NostrEvent>();
let subscriptions: Subscription[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * The relay client, once it has been fetched. Asked for rather than imported,
 * the way the corpus asks for it: this store runs on every page, and somebody
 * who only reads should not download a relay client to do it.
 */
let nostr: typeof import("@openspecs/nostr") | null = null;

const listeners = new Set<() => void>();

export const subscribeNoticesState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const noticesState = (): NoticesState => state;

/** The server knows nobody, so it has nobody's news: the browser reads this. */
export const serverNoticesState = (): NoticesState => NO_NOTICES;

const notify = (): void => {
  for (const listener of listeners) listener();
};

const recompute = (): NoticesState => {
  if (me === null || nostr === null) return NO_NOTICES;
  const mark = seenAt(me) ?? 0;
  const notices = nostr.sortNotices([...events.values()], { me });

  return {
    me,
    status: listed ? "ready" : "loading",
    notices,
    seenAt: mark,
    unread: unreadCount(notices, mark),
  };
};

const publish = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  state = recompute();
  notify();
};

const publishSoon = (): void => {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    publish();
  }, NOTIFY_MS);
};

const receive = (event: NostrEvent): void => {
  if (events.has(event.id)) return;
  events.set(event.id, event);
  publishSoon();
};

const close = (): void => {
  for (const subscription of subscriptions) subscription.close();
  subscriptions = [];
};

const open = async (pubkey: string): Promise<void> => {
  const [relay, relays] = await Promise.all([import("@openspecs/nostr"), import("./relays")]);
  nostr = relay;
  // Signing out, or signing in as somebody else, while this was being fetched.
  if (me !== pubkey) return;

  subscriptions.push(
    relay.subscribeNotices(pubkey, receive, {
      widen: () => relays.noticeRelays(pubkey),
      onEose: () => {
        // Said once, by the relays asked first. The ones added afterwards
        // announce nothing, and saying it again would put a bell that has
        // finished loading back into loading.
        listed = true;
        publish();
      },
    }),
  );
  publish();
};

/**
 * Idempotent per key, so a component mounted twice in development does not open
 * two subscriptions, and so does the header remounting on every navigation.
 *
 * Not gated on the session's status: reading what is addressed to a key needs
 * the key and no signer at all, so a key still under its PIN keeps its bell.
 */
export const startNotices = (pubkey: string): void => {
  if (typeof window === "undefined") return;
  if (subscriptions.length > 0 && me === pubkey) return;

  close();
  if (me !== pubkey) {
    events = new Map();
    state = { ...NO_NOTICES, me: pubkey, status: "loading" };
  }
  me = pubkey;
  listed = false;

  // Before anything is asked for, and deliberately: a relay that answers fast
  // could otherwise deliver a year of news to a key this browser has never seen
  // and have it counted as having happened while its reader was away.
  noteKey(pubkey);

  notify();
  void open(pubkey);
};

/**
 * The news has been shown, so it has been read. The mark is taken from what is
 * actually on screen rather than from the clock: a Nostr timestamp is written by
 * whoever signed the event, and marking up to now would swallow an event dated
 * in the future without it ever having been drawn.
 */
export const markNoticesSeen = (): void => {
  if (me === null) return;
  const newest = state.notices.reduce(
    (latest, notice) => Math.max(latest, notice.createdAt),
    state.seenAt,
  );
  markSeen(me, newest);
  publish();
};

/** Signing out. The mark stays where it is: it belongs to the key, not the session. */
export const clearNotices = (): void => {
  close();
  events = new Map();
  me = null;
  listed = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  state = NO_NOTICES;
  notify();
};
