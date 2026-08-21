import type { Filter } from "nostr-tools/filter";
import { parseCoordinate } from "./address";
import type { NostrEvent } from "./event";
import { COMMENT_KIND, type Comment, parseComment } from "./nip22";
import {
  DELETION_KIND,
  type Deletion,
  parseDeletion,
  parseReaction,
  REACTION_KIND,
  type Reaction,
  retractions,
} from "./nip25";
import { parseZapReceipt, ZAP_RECEIPT_KIND, type ZapReceipt } from "./nip57";
import { fetchRelayList, type RelayListOptions } from "./nip65";
import { queryRelays, type RelayOptions, relayPool, relaySet } from "./pool";

/**
 * Where a conversation about a specification is. `relay.ditto.pub` is the one
 * relay nostrhub has hard coded, so it holds that site's whole corpus of
 * comments; the next three are what better-nips reads and writes. Missing any of
 * them means showing half a conversation and calling it the discussion.
 * `relay.nmail.li` is this project's own, first in `DEFAULT_RELAYS` and the one
 * the crawler mirrors to.
 */
export const DISCUSSION_RELAYS = [
  "wss://relay.ditto.pub",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nmail.li",
];

/** A filter with a thousand ids in it is refused by relays that bound their inputs. */
const MAX_IDS_PER_FILTER = 200;

/**
 * `#A` alone catches every comment seen in the wild. The other three are asked
 * for on the same subscription anyway: `#a` for the client that scopes a thread
 * with the lowercase tag only, `#E` for the one that scopes an addressable root
 * by the id of the exact revision it was reading.
 *
 * Reactions and zaps are asked for by coordinate and by event id both: the
 * coordinate is what survives a revision, the id is what the clients that count
 * by event use.
 */
export const discussionFilters = (coordinate: string, specEventId: string): Filter[] => [
  { kinds: [COMMENT_KIND], "#A": [coordinate] },
  { kinds: [COMMENT_KIND], "#a": [coordinate] },
  { kinds: [COMMENT_KIND], "#E": [specEventId] },
  { kinds: [REACTION_KIND, ZAP_RECEIPT_KIND], "#a": [coordinate] },
  { kinds: [REACTION_KIND, ZAP_RECEIPT_KIND], "#e": [specEventId] },
];

/**
 * The second pass, once the ids of the comments and of the reactions are known:
 * what was reacted to them, zapped to them, and retracted from them. Nothing
 * indexes a deletion by the coordinate of the document it eventually concerns,
 * so it can only be asked for by the id it names.
 *
 * Comments are asked for again here, by parent id rather than by coordinate.
 * Some clients publish a reply carrying no root scope at all, only a pointer at
 * the comment it answers: asked for by coordinate it does not exist, and asked
 * for by its parent it is an ordinary part of the conversation.
 */
export const referenceFilters = (ids: string[]): Filter[] => {
  const unique = [...new Set(ids)];
  const filters: Filter[] = [];
  for (let index = 0; index < unique.length; index += MAX_IDS_PER_FILTER) {
    filters.push({
      kinds: [COMMENT_KIND, REACTION_KIND, ZAP_RECEIPT_KIND, DELETION_KIND],
      "#e": unique.slice(index, index + MAX_IDS_PER_FILTER),
    });
  }
  return filters;
};

export type Discussion = {
  comments: Comment[];
  reactions: Reaction[];
  zaps: ZapReceipt[];
  deletions: Deletion[];
};

export const EMPTY_DISCUSSION: Discussion = Object.freeze({
  comments: [],
  reactions: [],
  zaps: [],
  deletions: [],
});

/**
 * Three ways a comment can say it belongs here, because three families of client
 * say it differently: by the document's coordinate, by the id of the revision
 * its author was reading, or by naming nothing but the comment it answers.
 */
const belongs = (comment: Comment, coordinate: string, options: SortOptions): boolean => {
  if (comment.rootCoordinate === coordinate) return true;
  if (comment.rootCoordinate !== null) return false;
  if (options.specEventId !== undefined && comment.rootEventId === options.specEventId) return true;
  return comment.parentId !== null && (options.threadIds?.has(comment.parentId) ?? false);
};

export type SortOptions = {
  /**
   * Comments already known to belong to this thread. A reply that names no root
   * scope is only ever delivered by a filter on one of these ids, so it is part
   * of the conversation when it answers one of them and noise otherwise.
   */
  threadIds?: ReadonlySet<string>;
  /** The revision on the page, which is how an `E` scoped comment names it. */
  specEventId?: string;
};

/**
 * Relays index tag values, they do not check them: an event answering a filter
 * for this document may carry a coordinate for another one. Everything is
 * checked against the coordinate again here, where it costs a string compare.
 */
export const sortDiscussion = (
  events: NostrEvent[],
  coordinate: string,
  options: SortOptions = {},
): Discussion => {
  const comments: Comment[] = [];
  const reactions: Reaction[] = [];
  const zaps: ZapReceipt[] = [];
  const deletions: Deletion[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    if (event.kind === COMMENT_KIND) {
      const comment = parseComment(event);
      if (comment !== null && belongs(comment, coordinate, options)) comments.push(comment);
    } else if (event.kind === REACTION_KIND) {
      const reaction = parseReaction(event);
      if (reaction !== null) reactions.push(reaction);
    } else if (event.kind === ZAP_RECEIPT_KIND) {
      const zap = parseZapReceipt(event);
      if (zap !== null) zaps.push(zap);
    } else if (event.kind === DELETION_KIND) {
      const deletion = parseDeletion(event);
      if (deletion !== null) deletions.push(deletion);
    }
  }

  // A comment its own author asked to be forgotten is not shown, whether or not
  // the relays honoured the request: a reader who took their words back has
  // said so, and only the pages that ignore them keep them up.
  const retracted = retractions(deletions);
  return {
    comments: comments.filter((comment) => !retracted.get(comment.id)?.has(comment.pubkey)),
    reactions,
    zaps,
    deletions,
  };
};

export type DiscussionPointer = {
  coordinate: string;
  specEventId: string;
  /** Relays to ask beyond `DISCUSSION_RELAYS`, resolved by the caller. */
  relays?: string[];
};

export type DiscussionOptions = RelayOptions &
  RelayListOptions & {
    /** Set to false to read only from the relays named, ignoring the author's NIP-65 list. */
    outbox?: boolean;
  };

/** `options.relays` replaces the defaults, the way it does everywhere else here. */
const relaysFor = (pointer: DiscussionPointer, options: DiscussionOptions): string[] =>
  relaySet(options.relays ?? DISCUSSION_RELAYS, pointer.relays ?? []);

/**
 * Both sides of the author's NIP-65 list, because a conversation about their
 * document lands on both. Their write relays hold what they said themselves,
 * replies included; their read relays are where the outbox model tells everyone
 * else to address them, so that is where a comment about their document goes.
 *
 * Only the document's author is resolved. The people talking about it are as
 * many lookups as there are comments, and their words are already on the relays
 * asked here, since that is where they were sent.
 */
export const authorRelays = async (
  pubkey: string,
  options: RelayListOptions = {},
): Promise<string[]> => {
  const list = await fetchRelayList(pubkey, options);
  return relaySet(list.read, list.write);
};

const outboxOf = (pointer: DiscussionPointer, options: DiscussionOptions): Promise<string[]> => {
  if (options.outbox === false) return Promise.resolve([]);
  const author = parseCoordinate(pointer.coordinate);
  if (author === null) return Promise.resolve([]);
  return authorRelays(author.pubkey, options).catch(() => []);
};

const queryAll = (
  relays: string[],
  filters: Filter[],
  options: RelayOptions,
): Promise<NostrEvent[]> =>
  relays.length === 0
    ? Promise.resolve([])
    : Promise.all(filters.map((filter) => queryRelays(relays, filter, options))).then((found) =>
        found.flat(),
      );

/**
 * One round trip, for a caller that wants the conversation as it stands rather
 * than as it happens. The second pass is included: a reaction to a comment is
 * part of the discussion, and it cannot be asked for until the comment is here.
 *
 * The author's relays are resolved alongside the known ones rather than before
 * them, the way `fetchSpecs` does it: the lookup is worth making, and it is not
 * worth putting on the critical path of the relays that would have answered
 * anyway.
 */
export const fetchDiscussion = async (
  pointer: DiscussionPointer,
  options: DiscussionOptions = {},
): Promise<Discussion> => {
  const known = relaysFor(pointer, options);
  const outbox = outboxOf(pointer, options);
  const filters = discussionFilters(pointer.coordinate, pointer.specEventId);

  const [fromKnown, fromOutbox] = await Promise.all([
    queryAll(known, filters, options),
    outbox.then((relays) => queryAll(without(relays, known), filters, options)),
  ]);

  const events = [...fromKnown, ...fromOutbox];
  const scope = { specEventId: pointer.specEventId };
  const discussion = sortDiscussion(events, pointer.coordinate, scope);

  const threadIds = new Set(discussion.comments.map((comment) => comment.id));
  const ids = [...threadIds, ...discussion.reactions.map((reaction) => reaction.id)];
  if (ids.length === 0) return discussion;

  const references = referenceFilters(ids);
  const second = await Promise.all([
    queryAll(known, references, options),
    outbox.then((relays) => queryAll(without(relays, known), references, options)),
  ]);

  // Sorted once over both passes rather than merged after: a reply is returned
  // by the first pass for its coordinate and by the second for its parent's id,
  // and one pass over everything is what makes that one comment rather than two.
  return sortDiscussion([...events, ...second.flat()], pointer.coordinate, {
    ...scope,
    threadIds,
  });
};

const without = (relays: string[], already: string[]): string[] =>
  relays.filter((relay) => !already.includes(relay));

export type DiscussionSubscription = { close: () => void };

/**
 * The conversation as it happens. A page holding this open sees a comment posted
 * from another client appear where it belongs, without asking anyone to reload,
 * which is the whole argument for relays being the source of truth.
 *
 * Subscribing starts on the relays already known and widens to the author's own
 * once their list resolves, rather than waiting for it: the conversation should
 * be on screen while that lookup is still happening, and the relays it adds send
 * what they have the moment they are asked.
 *
 * The second pass is left to the caller: it depends on ids that arrive over
 * time, and only the caller knows which of them it has already asked about.
 */
export const subscribeDiscussion = (
  pointer: DiscussionPointer,
  onEvent: (event: NostrEvent) => void,
  options: DiscussionOptions & { onEose?: () => void } = {},
): DiscussionSubscription => {
  const filters = discussionFilters(pointer.coordinate, pointer.specEventId);
  const known = relaysFor(pointer, options);

  const subscription = open(known, filters, onEvent, options);
  void outboxOf(pointer, options).then((relays) =>
    subscription.widen(without(relays, known), options.onEose === undefined),
  );
  return subscription;
};

/**
 * The same, for the ids that only exist once the first events have arrived.
 *
 * Its end of stored events is worth knowing: it is the moment a caller learns
 * that none of these ids were retracted, which is the difference between showing
 * a comment and showing one that is about to be taken away again.
 */
export const subscribeReferences = (
  pointer: DiscussionPointer,
  ids: string[],
  onEvent: (event: NostrEvent) => void,
  options: DiscussionOptions & { onEose?: () => void } = {},
): DiscussionSubscription => {
  const filters = referenceFilters(ids);
  const known = relaysFor(pointer, options);

  const subscription = open(known, filters, onEvent, options);
  void outboxOf(pointer, options).then((relays) =>
    subscription.widen(without(relays, known), true),
  );
  return subscription;
};

type WideningSubscription = DiscussionSubscription & {
  /** Adds relays to a subscription already running, unless it has been closed. */
  widen: (relays: string[], quiet: boolean) => void;
};

const open = (
  relays: string[],
  filters: Filter[],
  onEvent: (event: NostrEvent) => void,
  options: DiscussionOptions & { onEose?: () => void },
): WideningSubscription => {
  const pool = options.pool ?? relayPool();
  const closers: { close: () => void }[] = [];
  let closed = false;

  const subscribe = (to: string[], onEose: (() => void) | undefined) => {
    if (closed || to.length === 0) return;
    for (const filter of filters) {
      closers.push(
        pool.subscribe(to, filter, {
          onevent: (event) => onEvent(event as NostrEvent),
          oneose: onEose,
        }),
      );
    }
  };

  subscribe(relays, options.onEose);

  return {
    // The widening relays do not report an end of stored events: the caller was
    // told the conversation had arrived once already, and saying so again would
    // put a page that has finished loading back into loading.
    widen: (more, quiet) => subscribe(more, quiet ? undefined : options.onEose),
    close: () => {
      closed = true;
      for (const closer of closers) closer.close();
    },
  };
};
