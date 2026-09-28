import { type EventDraft, type NostrEvent, nostrEventSchema, SPEC_KIND, tagValue } from "./event";

export const COMMENT_KIND = 1111;

/**
 * Named on every event this app publishes, the way the other two clients do,
 * and spelled the way the site and the kind:31990 spell it.
 */
export const CLIENT_NAME = "Open Specs";

/** The document a thread hangs from, which stays the root at every depth. */
export type CommentRoot = { coordinate: string; pubkey: string };

/** The comment being answered. Absent on a top level comment. */
export type CommentParent = { id: string; pubkey: string; relay?: string | null };

export type CommentDraft = {
  root: CommentRoot;
  parent?: CommentParent | null;
  content: string;
};

/**
 * Uppercase tags scope the root, lowercase point at the parent, and on a top
 * level comment both point at the document. NIP-22 also suggests an `e` tag
 * carrying the id of an addressable parent's current revision: it is left out
 * on purpose. Neither nostrhub nor better-nips emits one, both read the first
 * lowercase `e` as the parent, and a top level comment carrying one reads there
 * as a reply whose parent never arrived.
 */
export const buildComment = (draft: CommentDraft): EventDraft => {
  const { coordinate, pubkey } = draft.root;
  const parent = draft.parent ?? null;
  const hint = parent?.relay?.trim();

  return {
    kind: COMMENT_KIND,
    content: draft.content.trim(),
    tags: [
      ["A", coordinate],
      ["K", String(SPEC_KIND)],
      ["P", pubkey],
      ...(parent === null
        ? [
            ["a", coordinate],
            ["k", String(SPEC_KIND)],
            ["p", pubkey],
          ]
        : [
            hint ? ["e", parent.id, hint] : ["e", parent.id],
            ["k", String(COMMENT_KIND)],
            ["p", parent.pubkey],
          ]),
      ["client", CLIENT_NAME],
    ],
  };
};

export type Comment = {
  event: NostrEvent;
  id: string;
  pubkey: string;
  createdAt: number;
  content: string;
  /** The `A` root scope, falling back to `a` for the clients that publish only one. */
  rootCoordinate: string | null;
  /**
   * The `E` root scope: one exact revision of the document rather than the
   * document. Some clients scope an addressable root that way, and a comment
   * carrying only this one still belongs to the conversation.
   */
  rootEventId: string | null;
  /** The first lowercase `e`, which is what every client reads as the parent. */
  parentId: string | null;
};

/**
 * A comment with nothing in it is not a comment, and that is the only thing
 * refused here. How long a comment may be is an editorial question, so it
 * belongs where the comment is drawn rather than where it is read: dropping a
 * long one at this depth would lose words their author did write.
 */
export const parseComment = (input: unknown): Comment | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== COMMENT_KIND) return null;

  const event = parsed.data;
  const content = event.content.trim();
  if (content === "") return null;

  return {
    event,
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    content,
    rootCoordinate: tagValue(event, "A") || tagValue(event, "a") || null,
    rootEventId: tagValue(event, "E") || null,
    parentId: parentOf(event),
  };
};

/**
 * The first lowercase `e`, which is what every client reads as the parent, minus
 * the three ways an `e` on a top level comment points at the document instead.
 *
 * The lowercase `k` is the decisive one: it names the parent's kind, so anything
 * other than a comment means the parent is the document this thread hangs from.
 * nostrhub publishes exactly that shape, `e` alongside `k: 30817`, and reading it
 * literally would file a top level comment as a reply to something nothing here
 * asks for. Amethyst instead repeats its `E` root in `e`, which the second test
 * catches. The third is only there because an event cannot answer itself.
 */
const parentOf = (event: NostrEvent): string | null => {
  const parentId = tagValue(event, "e");
  if (parentId === "" || parentId === event.id) return null;
  if (parentId === tagValue(event, "E")) return null;

  const parentKind = tagValue(event, "k");
  if (parentKind !== "" && parentKind !== String(COMMENT_KIND)) return null;
  return parentId;
};

/**
 * A comment its replies answer and this page cannot show: taken back by its
 * author, or not found on any relay read. Kept as a line in its place, or a
 * reply would read as answering whatever sits above it instead.
 */
export type Gap = { id: string; createdAt: number; deleted: boolean };

export type CommentNode =
  | { comment: Comment; replies: CommentNode[] }
  | { gap: Gap; replies: CommentNode[] };

/** What a node stands for, whichever of the two it is: enough to key it and date it. */
export const headOf = (node: CommentNode): { id: string; createdAt: number } =>
  "gap" in node ? node.gap : node.comment;

export type ThreadOptions = {
  /** Comments their author deleted, kept only to hold their replies in place. */
  retracted?: Comment[];
  /** Who asked for which id to be forgotten, as `retractions` reads it. */
  retractions?: Map<string, Set<string>>;
};

type Entry = { id: string; createdAt: number; parentId: string | null; node: CommentNode };

type Dated = { id: string; createdAt: number };

const byTime = (a: Dated, b: Dated): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A gap that holds no reply has nothing to explain, so it goes. */
const prune = (nodes: CommentNode[]): CommentNode[] =>
  nodes.flatMap((node) => {
    const replies = prune(node.replies);
    return "gap" in node && replies.length === 0 ? [] : [{ ...node, replies }];
  });

/**
 * Oldest first, at every depth: a specification's discussion is a record, and a
 * record is read in the order it was written.
 *
 * A reply whose parent is not here hangs from a gap standing in for it, when its
 * `k` says the parent was a comment. Without that `k` nothing says so: some
 * clients point `e` at a revision of the document instead, and those replies
 * surface at the top, as a comment on the document is.
 */
export const threadComments = (
  comments: Comment[],
  { retracted = [], retractions = new Map() }: ThreadOptions = {},
): CommentNode[] => {
  const entries = new Map<string, Entry>();
  for (const comment of retracted) {
    entries.set(comment.id, {
      id: comment.id,
      createdAt: comment.createdAt,
      parentId: comment.parentId,
      node: { gap: { id: comment.id, createdAt: comment.createdAt, deleted: true }, replies: [] },
    });
  }
  for (const comment of comments) {
    entries.set(comment.id, {
      id: comment.id,
      createdAt: comment.createdAt,
      parentId: comment.parentId,
      node: { comment, replies: [] },
    });
  }

  // Oldest reply first, so a gap is dated by the earliest thing that answered it.
  for (const comment of [...retracted, ...comments].sort(byTime)) {
    const parentId = comment.parentId;
    if (parentId === null || entries.has(parentId)) continue;
    if (tagValue(comment.event, "k") !== String(COMMENT_KIND)) continue;
    // The lowercase `p` names the author of the comment answered, which is the
    // only key whose deletion of it counts.
    const author = tagValue(comment.event, "p");
    const deleted = author !== "" && retractions.get(parentId)?.has(author) === true;
    entries.set(parentId, {
      id: parentId,
      createdAt: comment.createdAt,
      parentId: null,
      node: { gap: { id: parentId, createdAt: comment.createdAt, deleted }, replies: [] },
    });
  }

  const parentOf = new Map<string, string>();
  // An event id is a hash of the event pointing at it, so a loop cannot be
  // built, only forged. It would render forever, which is reason enough to look.
  const wouldLoop = (id: string, ancestor: string): boolean => {
    let current: string | undefined = ancestor;
    while (current !== undefined) {
      if (current === id) return true;
      current = parentOf.get(current);
    }
    return false;
  };

  const roots: CommentNode[] = [];
  for (const entry of [...entries.values()].sort(byTime)) {
    const { parentId } = entry;
    const parent =
      parentId === null || wouldLoop(entry.id, parentId) ? undefined : entries.get(parentId);
    if (parent && parentId !== null) {
      parentOf.set(entry.id, parentId);
      parent.node.replies.push(entry.node);
    } else {
      roots.push(entry.node);
    }
  }
  return prune(roots);
};

/** Everyone who wrote something, which is what the thread is a record of. */
export const correspondents = (comments: Comment[]): string[] => [
  ...new Set(comments.map((comment) => comment.pubkey)),
];
