import { allTags, type EventDraft, type NostrEvent, nostrEventSchema, tagValue } from "./event";
import { CLIENT_NAME } from "./nip22";

export const REACTION_KIND = 7;
export const DELETION_KIND = 5;

/** A like, whatever the client that sent it wrote in `content`. */
export const LIKE = "+";

export type ReactionTarget = {
  id: string;
  pubkey: string;
  kind: number;
  /** Present only for an addressable target, and it is the durable half. */
  coordinate?: string | null;
  relay?: string | null;
};

/**
 * Both `e` and `a` on an addressable target, because they answer different
 * questions. An addressable event's id changes with every revision, so an
 * `e` alone detaches from the document the moment its author edits it; an `a`
 * alone is invisible to the clients that count reactions by event id.
 */
export const buildReaction = (target: ReactionTarget, content = LIKE): EventDraft => {
  const hint = target.relay?.trim();
  const coordinate = target.coordinate?.trim();

  return {
    kind: REACTION_KIND,
    content,
    tags: [
      hint ? ["e", target.id, hint] : ["e", target.id],
      ...(coordinate ? [["a", coordinate]] : []),
      ["p", target.pubkey],
      ["k", String(target.kind)],
      ["client", CLIENT_NAME],
    ],
  };
};

/** NIP-09. A relay may honour it or not, so the tally drops the reaction either way. */
export const buildRetraction = (reactionId: string): EventDraft => ({
  kind: DELETION_KIND,
  content: "",
  tags: [
    ["e", reactionId],
    ["k", String(REACTION_KIND)],
    ["client", CLIENT_NAME],
  ],
});

export type Reaction = {
  id: string;
  pubkey: string;
  createdAt: number;
  /** What to draw. `+` for a like, `:shortcode:` for a custom emoji, else the emoji itself. */
  symbol: string;
  /** A NIP-30 custom emoji's image, when the shortcode resolves to one. */
  emojiUrl: string | null;
  targetId: string | null;
  targetCoordinate: string | null;
};

const emojiUrlOf = (event: NostrEvent, content: string): string | null => {
  if (!/^:[a-z0-9_-]+:$/i.test(content)) return null;
  const shortcode = content.slice(1, -1);
  for (const tag of allTags(event, "emoji")) {
    if (tag[1] !== shortcode) continue;
    const url = (tag[2] ?? "").trim();
    // Author supplied, and it becomes an `src`: the same rule a picture follows.
    try {
      return new URL(url).protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Whatever a client put in `content` is kept, however unlike a symbol it looks:
 * a reaction nobody can draw is still a reader saying something, and the chip
 * that draws it is where the length of it is somebody's problem.
 */
export const parseReaction = (input: unknown): Reaction | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== REACTION_KIND) return null;

  const event = parsed.data;
  const content = event.content.trim();

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    // An empty reaction is a like: it is what the oldest clients sent, and NIP-25
    // still says to read it that way.
    symbol: content === "" ? LIKE : content,
    emojiUrl: emojiUrlOf(event, content),
    targetId: tagValue(event, "e") || null,
    targetCoordinate: tagValue(event, "a") || null,
  };
};

export type Deletion = { pubkey: string; ids: string[] };

export const parseDeletion = (input: unknown): Deletion | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== DELETION_KIND) return null;
  const ids = allTags(parsed.data, "e")
    .map((tag) => (tag[1] ?? "").trim())
    .filter((id) => id !== "");
  return ids.length === 0 ? null : { pubkey: parsed.data.pubkey, ids };
};

/**
 * Who asked for what to be forgotten. A kind 5 naming somebody else's event is a
 * request nobody has to honour, so the author is kept alongside the id and the
 * two are checked together.
 */
export const retractions = (deletions: Deletion[]): Map<string, Set<string>> => {
  const asked = new Map<string, Set<string>>();
  for (const deletion of deletions) {
    for (const id of deletion.ids) {
      const authors = asked.get(id) ?? new Set<string>();
      authors.add(deletion.pubkey);
      asked.set(id, authors);
    }
  }
  return asked;
};

export type ReactionTally = {
  symbol: string;
  emojiUrl: string | null;
  count: number;
  /** Who reacted, and with which event, so a reader can retract their own. */
  by: Record<string, string>;
};

/**
 * One reaction per key per symbol, newest kept: a client that resent a like is
 * one reader, not two. A deletion only counts against its own author, since a
 * kind 5 naming somebody else's event is a request nobody has to honour.
 */
export const tallyReactions = (
  reactions: Reaction[],
  deletions: Deletion[] = [],
): ReactionTally[] => {
  const retracted = retractions(deletions);
  const newest = new Map<string, Reaction>();
  for (const reaction of reactions) {
    if (retracted.get(reaction.id)?.has(reaction.pubkey)) continue;
    const key = `${reaction.pubkey}:${reaction.symbol}`;
    const current = newest.get(key);
    if (!current || reaction.createdAt > current.createdAt) newest.set(key, reaction);
  }

  const tallies = new Map<string, ReactionTally>();
  for (const reaction of newest.values()) {
    const tally = tallies.get(reaction.symbol) ?? {
      symbol: reaction.symbol,
      emojiUrl: reaction.emojiUrl,
      count: 0,
      by: {},
    };
    tally.count += 1;
    tally.by[reaction.pubkey] = reaction.id;
    tally.emojiUrl ??= reaction.emojiUrl;
    tallies.set(reaction.symbol, tally);
  }

  // Most reacted first, and a like ahead of an equally popular emoji: it is the
  // one symbol every client can send, so it is the one that means the most.
  return [...tallies.values()].sort(
    (a, b) =>
      b.count - a.count ||
      (a.symbol === LIKE ? -1 : b.symbol === LIKE ? 1 : a.symbol.localeCompare(b.symbol)),
  );
};

export const likeCount = (tallies: ReactionTally[]): number =>
  tallies.find((tally) => tally.symbol === LIKE)?.count ?? 0;

/** The id of this key's own like, which is what a retraction has to name. */
export const myLike = (tallies: ReactionTally[], me: string): string | undefined =>
  tallies.find((tally) => tally.symbol === LIKE)?.by[me];
