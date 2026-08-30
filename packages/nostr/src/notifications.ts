import type { Filter } from "nostr-tools/filter";
import { parseCoordinate, toCoordinate } from "./address";
import { DISCUSSION_RELAYS } from "./discussion";
import { type NostrEvent, SPEC_KIND, tagValue } from "./event";
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
import { type RelayOptions, relaySet } from "./pool";
import { DEFAULT_RELAYS, READ_RELAYS } from "./relay";
import type { Spec } from "./spec";
import { inChunks, openWidening, type Subscription, without } from "./subscribe";

/** What one page of news can be before the rest is history rather than news. */
export const MAX_NOTICES = 200;

/**
 * Four filters rather than one, and the reason is not only that a shared limit
 * lets reactions, the loudest kind here, crowd the comments out of it.
 *
 * NIP-22 scopes a thread's root author with `P` and the author being answered
 * with `p`, so a reply to somebody else's comment under my document names me in
 * `P` alone: asked for by `p` it does not exist. NIP-57 spends the same tag on
 * the opposite party. On a zap receipt `P` is who paid, so asking a relay for
 * kind 9735 by `P` returns every zap I ever sent, addressed to me, as news.
 */
export const notificationFilters = (pubkey: string): Filter[] => [
  { kinds: [COMMENT_KIND], "#p": [pubkey], limit: 100 },
  { kinds: [COMMENT_KIND], "#P": [pubkey], limit: 100 },
  { kinds: [REACTION_KIND], "#p": [pubkey], limit: 200 },
  { kinds: [ZAP_RECEIPT_KIND], "#p": [pubkey], limit: 100 },
];

/** Who else publishes under the names I publish under. Nobody is addressed in one. */
export const copyFilters = (identifiers: string[]): Filter[] =>
  inChunks(identifiers).map((chunk) => ({ kinds: [SPEC_KIND], "#d": chunk }));

/**
 * Whether anything held here has since been taken back. Deliberately not
 * `referenceFilters`, which asks for comments, reactions and zaps on the same
 * ids: those belong to a document's record, and a reaction to a comment somebody
 * wrote to me is their conversation rather than my news.
 */
export const targetFilters = (ids: string[]): Filter[] =>
  inChunks(ids).map((chunk) => ({ kinds: [DELETION_KIND], "#e": chunk }));

/** The events themselves, for the ids a reaction or a zap named and nothing explained. */
export const namedFilters = (ids: string[]): Filter[] =>
  inChunks(ids).map((chunk) => ({ ids: chunk }));

/**
 * The ids a reaction or a zap pointed at without saying which document it was
 * about, and which nothing here holds the event for yet.
 *
 * A client reacting to a comment has no coordinate to name, since a comment is
 * not addressable, so it names an id and nothing else. Fetched, that id is
 * either a comment I wrote, which makes the reaction mine to hear about, or it
 * is not, which makes the `p` tag on it somebody tagging a stranger.
 */
export const unnamedTargets = (events: NostrEvent[]): string[] => {
  const held = new Set(events.map((event) => event.id));
  const wanted = new Set<string>();

  for (const event of events) {
    if (event.kind !== REACTION_KIND && event.kind !== ZAP_RECEIPT_KIND) continue;
    if (tagValue(event, "a") !== "") continue;
    const targetId = tagValue(event, "e");
    if (targetId !== "" && !held.has(targetId)) wanted.add(targetId);
  }
  return [...wanted];
};

/**
 * What happened, which decides the sentence the row is drawn with.
 *
 * `comment` and `thread` both sit under a document of mine: the first answers
 * the document, the second answers somebody else inside it. `reply` answers
 * something I wrote, wherever it was written.
 */
export type NoticeKind = "comment" | "reply" | "thread" | "reaction" | "zap" | "copy";

export type Notice = {
  /** The event this is, which is what makes it one row however many relays served it. */
  id: string;
  kind: NoticeKind;
  /** Who did it. On a zap that is who paid, not the server that signed the receipt. */
  pubkey: string;
  createdAt: number;
  /** The document it happened under, which is where the row leads. */
  document: { pubkey: string; identifier: string; coordinate: string };
  /** What was answered, when it was something other than the document itself. */
  targetId: string | null;
  /**
   * Whether `targetId` is a comment of mine rather than a document of mine. It
   * decides both the sentence the row is drawn with and whether the link can
   * name a place in the conversation or only the conversation.
   */
  onComment: boolean;
  /** The words, the reaction's symbol, or the copy's title. */
  content: string;
  /** A NIP-30 custom emoji's image, on a reaction that named one. */
  emojiUrl: string | null;
  /** Satoshis, on a zap and nowhere else. */
  sats: number | null;
};

export type NoticeScope = {
  /** The reader these are addressed to. Nothing they did themselves is news to them. */
  me: string;
  /**
   * Other keys' documents under one of my names, already reduced to one live
   * revision per coordinate by whoever collected them.
   */
  copies?: Spec[];
  /** What the reader muted. Nothing from, about or under any of it is news. */
  muted?: {
    pubkeys: ReadonlySet<string>;
    eventIds: ReadonlySet<string>;
    coordinates: ReadonlySet<string>;
  };
};

/** Rebuilt rather than carried through, so one document has one spelling here. */
const documentOf = (coordinate: string | null) => {
  const pointer = coordinate === null ? null : parseCoordinate(coordinate);
  return pointer === null
    ? null
    : {
        pubkey: pointer.pubkey,
        identifier: pointer.identifier,
        coordinate: toCoordinate(pointer),
      };
};

/**
 * A comment is mine to hear about when it hangs from my document or when it
 * answers me, and the two are told apart by which tag names me. A reply that
 * names me in neither is somebody else's conversation, delivered because relays
 * index tag values and do not check them.
 */
const noticeFromComment = (comment: Comment, me: string): Notice | null => {
  if (comment.pubkey === me) return null;
  const document = documentOf(comment.rootCoordinate);
  if (document === null) return null;

  const answersMe = tagValue(comment.event, "p") === me;
  if (document.pubkey !== me && !answersMe) return null;

  return {
    id: comment.id,
    kind: comment.parentId === null ? "comment" : answersMe ? "reply" : "thread",
    pubkey: comment.pubkey,
    createdAt: comment.createdAt,
    document,
    targetId: comment.parentId,
    onComment: comment.parentId !== null,
    content: comment.content,
    emojiUrl: null,
    sats: null,
  };
};

/** A comment of mine, by id, so that what answers it can be attributed. */
type MyComments = ReadonlyMap<string, ReturnType<typeof documentOf>>;

/**
 * What a reaction or a zap was about, and whether it is mine to hear about.
 *
 * Anyone may put my key in a `p` tag, so that tag decides what a relay sends and
 * never what is shown. The target decides that. A coordinate naming a document
 * of mine is one I can see is mine; an event id is only mine once it has been
 * fetched and turns out to be a comment I wrote. Anything else is somebody
 * tagging me, and is dropped.
 */
const answered = (
  target: { targetId: string | null; targetCoordinate: string | null },
  me: string,
  mine: MyComments,
): { document: NonNullable<ReturnType<typeof documentOf>>; onComment: boolean } | null => {
  const named = documentOf(target.targetCoordinate);
  if (named !== null && named.pubkey === me) return { document: named, onComment: false };

  const comment = target.targetId === null ? undefined : mine.get(target.targetId);
  return comment === undefined || comment === null ? null : { document: comment, onComment: true };
};

const noticeFromReaction = (
  reaction: Reaction,
  event: NostrEvent,
  me: string,
  mine: MyComments,
): Notice | null => {
  if (event.pubkey === me) return null;
  const about = answered(reaction, me, mine);
  if (about === null) return null;

  return {
    id: reaction.id,
    kind: "reaction",
    pubkey: reaction.pubkey,
    createdAt: reaction.createdAt,
    document: about.document,
    targetId: reaction.targetId,
    onComment: about.onComment,
    content: reaction.symbol,
    emojiUrl: reaction.emojiUrl,
    sats: null,
  };
};

/**
 * A receipt is signed by the recipient's LNURL server, so the payer is only
 * known through the request it echoed back. A receipt that carries no request
 * names nobody, and a row that cannot say who paid is not worth a line.
 */
const noticeFromZap = (zap: ZapReceipt, me: string, mine: MyComments): Notice | null => {
  if (zap.recipient !== me || zap.zapper === null || zap.zapper === me) return null;
  const about = answered(zap, me, mine);
  if (about === null) return null;

  return {
    id: zap.id,
    kind: "zap",
    pubkey: zap.zapper,
    createdAt: zap.createdAt,
    document: about.document,
    targetId: zap.targetId,
    onComment: about.onComment,
    content: zap.comment,
    emojiUrl: null,
    sats: zap.amountSats,
  };
};

const noticeFromCopy = (spec: Spec, me: string): Notice | null => {
  if (spec.pubkey === me || spec.isEmpty) return null;
  return {
    id: spec.event.id,
    kind: "copy",
    pubkey: spec.pubkey,
    createdAt: spec.createdAt,
    document: {
      pubkey: spec.pubkey,
      identifier: spec.identifier,
      coordinate: toCoordinate(spec),
    },
    targetId: null,
    onComment: false,
    content: spec.title,
    emojiUrl: null,
    sats: null,
  };
};

/**
 * A client that sent the same like twice is one reader and not two, which is the
 * rule `tallyReactions` applies to a document's own tally. Everything else is
 * one row per event: this site counts nothing that has a name attached to it.
 */
const collapsed = (notices: Notice[]): Notice[] => {
  const kept = new Map<string, Notice>();
  for (const notice of notices) {
    if (notice.kind !== "reaction") {
      kept.set(notice.id, notice);
      continue;
    }
    const key = `${notice.pubkey}:${notice.targetId ?? notice.document.coordinate}:${notice.content}`;
    const current = kept.get(key);
    if (current === undefined || notice.createdAt > current.createdAt) kept.set(key, notice);
  }
  return [...kept.values()];
};

/** Dropped before the collapse, so a muted like is not the one a collapse keeps. */
const muted = (scope: NoticeScope["muted"]) => (notice: Notice) =>
  scope !== undefined &&
  (scope.pubkeys.has(notice.pubkey) ||
    scope.eventIds.has(notice.id) ||
    scope.coordinates.has(notice.document.coordinate));

const retracted = (deletions: Deletion[]) => {
  const taken = retractions(deletions);
  return (notice: Notice): boolean => taken.get(notice.id)?.has(notice.pubkey) === true;
};

/**
 * Everything addressed to one key, newest first. Every check a relay could have
 * skipped is made again here, where it costs a string compare: what a filter
 * matched is a tag, and a tag is only what somebody wrote.
 */
export const sortNotices = (events: NostrEvent[], scope: NoticeScope): Notice[] => {
  const notices: Notice[] = [];
  const deletions: Deletion[] = [];
  const seen = new Set<string>();

  // My own comments are never news, but they are what a reaction naming an id
  // and nothing else has to be read against, so they are indexed before the
  // pass that would otherwise throw them away.
  const mine = new Map<string, ReturnType<typeof documentOf>>();
  for (const event of events) {
    if (event.kind !== COMMENT_KIND || event.pubkey !== scope.me) continue;
    const comment = parseComment(event);
    if (comment !== null) mine.set(comment.id, documentOf(comment.rootCoordinate));
  }

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    if (event.kind === COMMENT_KIND) {
      const comment = parseComment(event);
      const notice = comment === null ? null : noticeFromComment(comment, scope.me);
      if (notice !== null) notices.push(notice);
    } else if (event.kind === REACTION_KIND) {
      const reaction = parseReaction(event);
      const notice = reaction === null ? null : noticeFromReaction(reaction, event, scope.me, mine);
      if (notice !== null) notices.push(notice);
    } else if (event.kind === ZAP_RECEIPT_KIND) {
      const zap = parseZapReceipt(event);
      const notice = zap === null ? null : noticeFromZap(zap, scope.me, mine);
      if (notice !== null) notices.push(notice);
    } else if (event.kind === DELETION_KIND) {
      const deletion = parseDeletion(event);
      if (deletion !== null) deletions.push(deletion);
    }
  }

  for (const spec of scope.copies ?? []) {
    const notice = noticeFromCopy(spec, scope.me);
    if (notice !== null && !seen.has(notice.id)) {
      seen.add(notice.id);
      notices.push(notice);
    }
  }

  const taken = retracted(deletions);
  const hidden = muted(scope.muted);
  return collapsed(notices.filter((notice) => !hidden(notice)))
    .filter((notice) => !taken(notice))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_NOTICES);
};

export type NoticeOptions = RelayOptions & {
  /**
   * More relays to ask, resolved by the caller while this is already running.
   * A callback rather than a list: which relays reach a key is the app's policy,
   * and waiting on that lookup would leave the reader with nothing meanwhile.
   */
  widen?: () => Promise<string[]>;
};

const openNotices = (
  known: string[],
  filters: Filter[],
  onEvent: (event: NostrEvent) => void,
  options: NoticeOptions & { onEose?: () => void },
): Subscription => {
  const subscription = openWidening(known, filters, onEvent, options);
  void (options.widen?.() ?? Promise.resolve([]))
    .then((more) => subscription.widen(without(more, known), true))
    .catch(() => {});
  return subscription;
};

/**
 * Everything addressed to one key, as it happens. `DISCUSSION_RELAYS` is asked
 * first because that is where `writeRelays` sends a comment and where the other
 * clients reading this kind of document send theirs.
 */
export const subscribeNotices = (
  pubkey: string,
  onEvent: (event: NostrEvent) => void,
  options: NoticeOptions & { onEose?: () => void } = {},
): Subscription =>
  openNotices(
    relaySet(options.relays ?? [...DISCUSSION_RELAYS, ...DEFAULT_RELAYS]),
    notificationFilters(pubkey),
    onEvent,
    options,
  );

/**
 * The same, for the names I publish under. A different relay set, because this
 * is the one thing here nobody addresses to me: `READ_RELAYS` is where this site
 * and its crawler look for documents, so it is where a copy of one is.
 */
export const subscribeCopies = (
  identifiers: string[],
  onEvent: (event: NostrEvent) => void,
  options: NoticeOptions & { onEose?: () => void } = {},
): Subscription =>
  openNotices(
    relaySet(options.relays ?? [...READ_RELAYS, ...DISCUSSION_RELAYS]),
    copyFilters(identifiers),
    onEvent,
    options,
  );

/**
 * The events a reaction or a zap named. Read from the relays that hold the
 * conversations, since what is being asked for is a comment.
 */
export const subscribeNamed = (
  ids: string[],
  onEvent: (event: NostrEvent) => void,
  options: NoticeOptions & { onEose?: () => void } = {},
): Subscription =>
  openNotices(
    relaySet(options.relays ?? [...DISCUSSION_RELAYS, ...DEFAULT_RELAYS]),
    namedFilters(ids),
    onEvent,
    options,
  );

/** Whether anything held is still standing, asked by the ids it would be taken back by. */
export const subscribeRetractions = (
  ids: string[],
  onEvent: (event: NostrEvent) => void,
  options: NoticeOptions & { onEose?: () => void } = {},
): Subscription =>
  openNotices(
    relaySet(options.relays ?? [...DISCUSSION_RELAYS, ...DEFAULT_RELAYS]),
    targetFilters(ids),
    onEvent,
    options,
  );
