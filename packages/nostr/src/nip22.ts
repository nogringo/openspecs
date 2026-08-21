import { type EventDraft, type NostrEvent, nostrEventSchema, SPEC_KIND, tagValue } from "./event";

export const COMMENT_KIND = 1111;

/** Named on every event this app publishes, the way the other two clients do. */
export const CLIENT_NAME = "openspecs";

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

export type CommentNode = { comment: Comment; replies: CommentNode[] };

/**
 * Oldest first, at every depth: a specification's discussion is a record, and a
 * record is read in the order it was written.
 *
 * A reply whose parent is not here surfaces at the top rather than disappearing.
 * That covers the comment answering something the relays no longer serve, and
 * the client that pointed its parent at a revision of the document instead.
 */
export const threadComments = (comments: Comment[]): CommentNode[] => {
  const unique = new Map<string, Comment>();
  for (const comment of comments) unique.set(comment.id, comment);

  const ordered = [...unique.values()].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const nodes = new Map<string, CommentNode>();
  for (const comment of ordered) nodes.set(comment.id, { comment, replies: [] });

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
  for (const comment of ordered) {
    const node = nodes.get(comment.id);
    if (!node) continue;
    const parentId = comment.parentId;
    const parent =
      parentId === null || wouldLoop(comment.id, parentId) ? undefined : nodes.get(parentId);
    if (parent && parentId !== null) {
      parentOf.set(comment.id, parentId);
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
};

/** Everyone who wrote something, which is what the thread is a record of. */
export const correspondents = (comments: Comment[]): string[] => [
  ...new Set(comments.map((comment) => comment.pubkey)),
];
