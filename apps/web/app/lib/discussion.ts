import type {
  CommentNode,
  Discussion,
  DiscussionPointer,
  DiscussionSubscription,
  NostrEvent,
  ReactionTally,
} from "@openspecs/nostr";
import {
  correspondents,
  sortDiscussion,
  subscribeDiscussion,
  subscribeReferences,
  tallyReactions,
  threadComments,
  totalSats,
} from "@openspecs/nostr";

export type DiscussionStatus = "idle" | "loading" | "ready";

/** What a document or a comment was answered with, drawn as one row of chips. */
export type Response = { reactions: ReactionTally[]; zapSats: number };

export const NO_RESPONSE: Response = Object.freeze({ reactions: [], zapSats: 0 });

export type DiscussionState = {
  /** Which document this is about, so a page never draws another's conversation. */
  coordinate: string;
  status: DiscussionStatus;
  roots: CommentNode[];
  count: number;
  /** Everyone who wrote something, which is what the record is a record of. */
  correspondents: string[];
  /** What the document itself was answered with. */
  document: Response;
  /** The same, per comment id. */
  byComment: Record<string, Response>;
};

export const EMPTY_DISCUSSION: DiscussionState = Object.freeze({
  coordinate: "",
  status: "idle",
  roots: [],
  count: 0,
  correspondents: [],
  document: NO_RESPONSE,
  byComment: {},
});

/** Often enough to watch a conversation arrive, rarely enough not to rethread on every event. */
const NOTIFY_MS = 150;

/**
 * How long a conversation that came back empty is given to prove itself empty.
 * Relays answer at their own pace and the end of one relay's stored events is
 * not the end of another's, so a thread that looks empty for a moment is only
 * one relay having finished first.
 */
const QUIET_MS = 500;

/**
 * And how long the whole record waits before it gives up and shows what it has.
 * Nothing indexes a deletion by the document it eventually concerns, so a
 * retraction can only be asked for by the id of what it takes back, one round
 * trip behind. Showing a comment in between is showing something about to be
 * taken away, which is the flicker this whole dance exists to avoid.
 */
const SETTLE_MS = 4000;

let state = EMPTY_DISCUSSION;
/** The relays that hold the conversation have said what they hold. */
let listed = false;
/** And nothing in it turned out to have been retracted. */
let settled = false;
let settling: ReturnType<typeof setTimeout> | null = null;
let quieting: ReturnType<typeof setTimeout> | null = null;
/** Second-pass subscriptions that have not said what they hold yet. */
let awaiting = 0;
let pointer: DiscussionPointer | null = null;
let events = new Map<string, NostrEvent>();
/** Comments a second pass already covers, so widening it asks only about the new ones. */
let asked = new Set<string>();
let subscriptions: DiscussionSubscription[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

export const subscribeDiscussionState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const discussionState = (): DiscussionState => state;

/** The server holds no conversation: it renders the document, the browser reads the rest. */
export const serverDiscussionState = (): DiscussionState => EMPTY_DISCUSSION;

const notify = (): void => {
  for (const listener of listeners) listener();
};

type Target = { id: string; coordinate: string | null };

/**
 * A reaction or a zap names what it answered by event id, by coordinate, or by
 * both. Only the coordinate survives an edit, since an addressable event is
 * given a new id every time its author saves it, so a document is recognised by
 * its coordinate first and by the id of the revision on the page second.
 *
 * A comment has no coordinate, so there is no way for the two to be confused.
 */
const answers = (
  reference: { targetId: string | null; targetCoordinate: string | null },
  target: Target,
): boolean =>
  (target.coordinate !== null && reference.targetCoordinate === target.coordinate) ||
  reference.targetId === target.id;

const responseTo = (discussion: Discussion, target: Target): Response => ({
  reactions: tallyReactions(
    discussion.reactions.filter((reaction) => answers(reaction, target)),
    discussion.deletions,
  ),
  zapSats: totalSats(discussion.zaps.filter((zap) => answers(zap, target))),
});

/**
 * Every invoice a receipt in this conversation says was paid. A page that handed
 * one out learns here that it was settled, without asking anybody's server and
 * without the reader telling it anything: the receipt names the invoice.
 */
let paid = new Set<string>();

export const invoicePaid = (invoice: string): boolean => paid.has(invoice.trim().toLowerCase());

/** The state to draw, and the reaction ids the next pass has to ask about. */
type Recomputed = { state: DiscussionState; reactions: string[] };

const recompute = (): Recomputed => {
  const current = pointer;
  if (current === null) return { state: EMPTY_DISCUSSION, reactions: [] };

  const all = [...events.values()];
  const scope = { specEventId: current.specEventId };
  // Sorted twice, because a reply naming no document is only admitted once the
  // comments that do name it are known, and the first pass is what finds them.
  const named = sortDiscussion(all, current.coordinate, scope);
  const discussion = sortDiscussion(all, current.coordinate, {
    ...scope,
    threadIds: new Set(named.comments.map((comment) => comment.id)),
  });

  paid = new Set(discussion.zaps.map((zap) => zap.bolt11.trim().toLowerCase()));

  const byComment: Record<string, Response> = {};
  for (const comment of discussion.comments) {
    byComment[comment.id] = responseTo(discussion, { id: comment.id, coordinate: null });
  }

  return {
    state: {
      coordinate: current.coordinate,
      // Ready means the record can be read, not that events stopped arriving:
      // the relays have listed what they hold, and nothing in it was retracted.
      status: pointer === null ? "idle" : listed && settled ? "ready" : "loading",
      roots: threadComments(discussion.comments),
      count: discussion.comments.length,
      correspondents: correspondents(discussion.comments),
      document: responseTo(discussion, {
        id: current.specEventId,
        coordinate: current.coordinate,
      }),
      byComment,
    },
    reactions: discussion.reactions.map((reaction) => reaction.id),
  };
};

/**
 * What a comment was answered with can only be asked for by its id, which only
 * exists once the comment itself has arrived. Reactions are asked about too, and
 * for the same reason: a retraction names the reaction it takes back, so a
 * reaction nobody asked about is one that can never be seen to have been undone.
 *
 * Every new id opens one more subscription rather than replacing the one
 * running: the relays have already sent what they hold for the ids asked
 * before, and asking again pays for it twice.
 */
const askAbout = (state: DiscussionState, reactions: string[]): void => {
  const current = pointer;
  if (current === null) return;

  const ids: string[] = [];
  const want = (id: string) => {
    if (!asked.has(id)) ids.push(id);
  };

  const walk = (walking: CommentNode[]): void => {
    for (const node of walking) {
      want(node.comment.id);
      walk(node.replies);
    }
  };
  walk(state.roots);
  for (const id of reactions) want(id);

  if (ids.length === 0) return;
  for (const id of ids) asked.add(id);

  // Until every one of these has answered, nobody knows whether what arrived is
  // still standing, and a retraction always arrives before the answer that ends
  // the question: it is one of the things being asked for.
  if (settled) {
    subscriptions.push(subscribeReferences(current, ids, receive));
    return;
  }

  awaiting += 1;
  subscriptions.push(
    subscribeReferences(current, ids, receive, {
      onEose: () => {
        awaiting -= 1;
        if (awaiting === 0) settle();
      },
    }),
  );
};

/** Nothing left to learn about what has arrived, so the record can be read. */
function settle(): void {
  if (settled) return;
  settled = true;
  for (const pending of [settling, quieting]) if (pending !== null) clearTimeout(pending);
  settling = null;
  quieting = null;
  publish();
}

/**
 * A conversation with nothing in it has nothing to ask a second question about,
 * so it would otherwise wait out the whole deadline. This settles it once the
 * relays have gone quiet, and restarts on every event, so the moment anything
 * does arrive the second pass takes over the waiting.
 */
const settleWhenQuiet = (): void => {
  if (settled) return;
  if (quieting !== null) clearTimeout(quieting);
  quieting = setTimeout(() => {
    quieting = null;
    if (listed && awaiting === 0) settle();
  }, QUIET_MS);
};

const publish = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const next = recompute();
  state = next.state;
  askAbout(state, next.reactions);
  notify();
};

const publishSoon = (): void => {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    publish();
  }, NOTIFY_MS);
};

function receive(event: NostrEvent): void {
  if (events.has(event.id)) return;
  events.set(event.id, event);
  settleWhenQuiet();
  publishSoon();
}

const close = (): void => {
  for (const subscription of subscriptions) subscription.close();
  subscriptions = [];
};

/**
 * Idempotent per document, so a component mounted twice in development does not
 * open the conversation twice. Coming back to the same document keeps what has
 * already arrived rather than blanking the page to fetch it again; a different
 * document forgets the one before it.
 */
export const startDiscussion = (next: DiscussionPointer): void => {
  if (typeof window === "undefined") return;
  if (subscriptions.length > 0 && pointer?.coordinate === next.coordinate) return;

  close();
  if (pointer?.coordinate !== next.coordinate) {
    events = new Map();
    state = { ...EMPTY_DISCUSSION, coordinate: next.coordinate, status: "loading" };
  }
  // Cleared even when the events are kept: the subscriptions watching these ids
  // were just closed, and nothing would reopen them.
  asked = new Set();
  listed = false;
  settled = false;
  awaiting = 0;
  pointer = next;

  // A relay that never answers must not be able to keep the record hidden.
  for (const pending of [settling, quieting]) if (pending !== null) clearTimeout(pending);
  quieting = null;
  settling = setTimeout(() => {
    settling = null;
    settled = true;
    publish();
  }, SETTLE_MS);

  notify();

  subscriptions.push(
    subscribeDiscussion(next, receive, {
      onEose: () => {
        // Said once, by the relays that held the conversation already. The
        // author's own join the subscription later and announce nothing.
        listed = true;
        publish();
        settleWhenQuiet();
      },
    }),
  );
  publish();
};

/**
 * An event this browser just published, shown before any relay has echoed it
 * back. The subscription delivers the same event moments later and drops it as a
 * duplicate, so this is a head start rather than a second copy.
 */
export const addToDiscussion = (event: NostrEvent): void => receive(event);

export const stopDiscussion = (): void => close();

/** Test seam, and what a reader leaving the document behind eventually calls. */
export const clearDiscussion = (): void => {
  close();
  events = new Map();
  asked = new Set();
  paid = new Set();
  pointer = null;
  listed = false;
  settled = false;
  awaiting = 0;
  for (const pending of [timer, settling, quieting]) if (pending !== null) clearTimeout(pending);
  timer = null;
  settling = null;
  quieting = null;
  state = EMPTY_DISCUSSION;
};
