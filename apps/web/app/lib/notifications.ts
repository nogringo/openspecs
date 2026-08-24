import type { NostrEvent, Notice, Spec, Subscription } from "@openspecs/nostr";
import { alertPermission, alertsWanted, clearAlerts, showAlert } from "./alerts";
import { alertLine, noticePath } from "./notice-copy";
import { authorName } from "./profile";
import { authorsState } from "./profiles";
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

/**
 * One filter's worth of names, the wall `copyFilters` chunks at. Somebody who
 * publishes more documents than this is watched for the first two hundred:
 * asking every relay about a thousand names to draw a row nobody may ever get
 * costs more than the row is worth.
 */
const MAX_WATCHED_NAMES = 200;

/**
 * How long after connecting nothing is knocked about, however loudly it arrives.
 *
 * A backfill is not news: the relays are sending a year of it in the first
 * second. The end of stored events is not enough on its own either, since the
 * relays added by widening announce nothing and keep dribbling stored events
 * afterwards, so both this and that first announcement have to have passed.
 */
const ALERT_AFTER_MS = 3000;

let state = NO_NOTICES;
let me: string | null = null;
/** The relays have listed what they hold. Not that events stopped arriving. */
let listed = false;
let events = new Map<string, NostrEvent>();
/** Other keys' documents under one of my names, one live revision per coordinate. */
let copies = new Map<string, Spec>();
/** The names I publish under, which is what makes a copy a copy of mine. */
let names = new Set<string>();
/** Ids a second pass already covers, so widening it asks only about the new ones. */
let asked = new Set<string>();
/** Everything already weighed for a knock, whether or not it got one. */
let weighed = new Set<string>();
/** When the backfill stops counting as backfill. */
let alertsFrom = 0;
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
  const notices = nostr.sortNotices([...events.values()], { me, copies: [...copies.values()] });

  return {
    me,
    status: listed ? "ready" : "loading",
    notices,
    seenAt: mark,
    unread: unreadCount(notices, mark),
  };
};

/**
 * The two questions that can only be asked once the answers to the first have
 * arrived: whether what is held has since been taken back, and what the events
 * a reaction pointed at without explaining actually are.
 *
 * Every new id opens one more subscription rather than replacing the one
 * running: the relays have already sent what they hold for the ids asked
 * before, and asking again pays for it twice.
 *
 * Unlike the conversation under a document, nothing here waits on these. A
 * conversation is the page, so it is worth four seconds not to show a comment
 * about to be taken away again. A notification is a glance, and a bell with no
 * number on it for four seconds of every page load is the worse lie.
 */
const askAbout = (notices: Notice[]): void => {
  if (nostr === null) return;

  const want = (ids: string[]) => ids.filter((id) => !asked.has(id));

  // Zaps are left out: a receipt is signed by somebody's LNURL server, and a
  // deletion of it by anybody else is not the author taking their words back.
  const standing = want(
    notices.filter((notice) => notice.kind !== "copy" && notice.kind !== "zap").map((n) => n.id),
  );
  const named = want(nostr.unnamedTargets([...events.values()]));

  for (const id of [...standing, ...named]) asked.add(id);
  if (standing.length > 0) subscriptions.push(nostr.subscribeRetractions(standing, receive));
  if (named.length > 0) subscriptions.push(nostr.subscribeNamed(named, receive));
};

/**
 * Whether the browser may knock about what just arrived. Every one of these has
 * to hold, and the awkward one is the third: news that arrives while somebody is
 * looking at the page has already been delivered by the page.
 */
const mayAlert = (): boolean =>
  listed &&
  Date.now() >= alertsFrom &&
  alertsWanted() &&
  alertPermission() === "granted" &&
  typeof document !== "undefined" &&
  document.visibilityState === "hidden";

/**
 * Everything is weighed exactly once, whether or not it knocks. So a backfill,
 * which fails the gate on arrival, is not knocked about later when the reader
 * switches away from the tab and something new comes in behind it.
 */
const knockAbout = (notices: Notice[], mark: number): void => {
  const fresh = notices.filter((notice) => !weighed.has(notice.id));
  for (const notice of fresh) weighed.add(notice.id);
  if (!mayAlert()) return;

  const authors = authorsState();
  for (const notice of fresh) {
    if (notice.createdAt <= mark) continue;
    const npub = nostr === null ? notice.pubkey : nostr.toNpub(notice.pubkey);
    showAlert({
      body: alertLine(notice, authorName(authors[notice.pubkey] ?? null, npub)),
      path: noticePath(notice),
    });
  }
};

const publish = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  state = recompute();
  askAbout(state.notices);
  knockAbout(state.notices, state.seenAt);
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

/**
 * A copy is held as a document rather than as an event, keyed by its coordinate.
 * An addressable event gets a new id every time its author saves it, so the same
 * copy revised four times is four events and one thing that happened: somebody
 * else is publishing under your name. This is `latestByCoordinate` applied one
 * event at a time, tie broken on the lower id as NIP-01 breaks it, and the row
 * ends up dated by the newest revision, which is when they last touched it.
 */
const receiveCopy = (event: NostrEvent): void => {
  if (nostr === null || me === null) return;
  const spec = nostr.parseSpec(event);
  // Relays index tag values, they do not check them, and a withdrawn copy is a
  // copy taken back. The name is checked again for the first reason.
  if (spec === null || spec.pubkey === me || spec.isEmpty) return;
  if (!names.has(spec.identifier)) return;

  const coordinate = nostr.toCoordinate(spec);
  const current = copies.get(coordinate);
  if (current !== undefined) {
    if (spec.createdAt < current.createdAt) return;
    if (spec.createdAt === current.createdAt && spec.event.id >= current.event.id) return;
  }
  copies.set(coordinate, spec);
  publishSoon();
};

/**
 * Which names to watch, which nothing can say until my own documents are known.
 * A second round trip, and deliberately behind the first: what was addressed to
 * me is on screen while this is still being asked for.
 *
 * A name I published an empty revision over is left out. That is a judgement
 * call worth naming, since the opposite reading holds too: somebody taking over
 * a name I withdrew is arguably the thing I most want to hear about. Withdrawing
 * is how this site says a document is gone, and a document that is gone has no
 * copies to speak of.
 */
const watchCopies = async (
  pubkey: string,
  relay: typeof import("@openspecs/nostr"),
): Promise<void> => {
  const mine = await relay.fetchSpecs({ authors: [pubkey] });
  if (me !== pubkey) return;

  names = new Set(
    [...new Set(mine.filter((spec) => !spec.isEmpty).map((spec) => spec.identifier))].slice(
      0,
      MAX_WATCHED_NAMES,
    ),
  );
  if (names.size === 0 || me !== pubkey) return;

  subscriptions.push(relay.subscribeCopies([...names], receiveCopy));
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
  void watchCopies(pubkey, relay);
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
    copies = new Map();
    names = new Set();
    state = { ...NO_NOTICES, me: pubkey, status: "loading" };
  }
  me = pubkey;
  listed = false;
  // Cleared even when the events are kept: the subscriptions watching these ids
  // were just closed, and nothing would reopen them.
  asked = new Set();
  weighed = new Set();
  alertsFrom = Date.now() + ALERT_AFTER_MS;

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
  copies = new Map();
  names = new Set();
  asked = new Set();
  weighed = new Set();
  me = null;
  clearAlerts();
  listed = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  state = NO_NOTICES;
  notify();
};
