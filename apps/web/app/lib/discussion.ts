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

let state = EMPTY_DISCUSSION;
let status: DiscussionStatus = "idle";
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

const recompute = (): DiscussionState => {
  const current = pointer;
  if (current === null) return EMPTY_DISCUSSION;

  const all = [...events.values()];
  const scope = { specEventId: current.specEventId };
  // Sorted twice, because a reply naming no document is only admitted once the
  // comments that do name it are known, and the first pass is what finds them.
  const named = sortDiscussion(all, current.coordinate, scope);
  const discussion = sortDiscussion(all, current.coordinate, {
    ...scope,
    threadIds: new Set(named.comments.map((comment) => comment.id)),
  });

  const byComment: Record<string, Response> = {};
  for (const comment of discussion.comments) {
    byComment[comment.id] = responseTo(discussion, { id: comment.id, coordinate: null });
  }

  return {
    coordinate: current.coordinate,
    status,
    roots: threadComments(discussion.comments),
    count: discussion.comments.length,
    correspondents: correspondents(discussion.comments),
    document: responseTo(discussion, {
      id: current.specEventId,
      coordinate: current.coordinate,
    }),
    byComment,
  };
};

/**
 * What a comment was answered with can only be asked for by its id, which only
 * exists once the comment itself has arrived. Every new id opens one more
 * subscription rather than replacing the one running: the relays have already
 * sent what they hold for the ids asked before, and asking again pays for it
 * twice.
 */
const askAbout = (nodes: CommentNode[]): void => {
  const current = pointer;
  if (current === null) return;

  const ids: string[] = [];
  const walk = (walking: CommentNode[]): void => {
    for (const node of walking) {
      if (!asked.has(node.comment.id)) ids.push(node.comment.id);
      walk(node.replies);
    }
  };
  walk(nodes);

  if (ids.length === 0) return;
  for (const id of ids) asked.add(id);
  subscriptions.push(subscribeReferences(current, ids, receive));
};

const publish = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  state = recompute();
  askAbout(state.roots);
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
    status = "loading";
    state = { ...EMPTY_DISCUSSION, coordinate: next.coordinate, status };
  }
  // Cleared even when the events are kept: the subscriptions watching these ids
  // were just closed, and nothing would reopen them.
  asked = new Set();
  pointer = next;
  notify();

  subscriptions.push(
    subscribeDiscussion(next, receive, {
      onEose: () => {
        // Said once, by the relays that held the conversation already. The
        // author's own join the subscription later and announce nothing.
        status = "ready";
        publish();
      },
    }),
  );
  publish();
};

export const stopDiscussion = (): void => close();

/** Test seam, and what a reader leaving the document behind eventually calls. */
export const clearDiscussion = (): void => {
  close();
  events = new Map();
  asked = new Set();
  pointer = null;
  status = "idle";
  if (timer !== null) clearTimeout(timer);
  timer = null;
  state = EMPTY_DISCUSSION;
};
