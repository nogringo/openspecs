import { verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { SPEC_KIND, tagValue } from "../src/event";
import {
  buildComment,
  COMMENT_KIND,
  correspondents,
  parseComment,
  threadComments,
} from "../src/nip22";
import { discussionCase, discussionEvents } from "./fixtures";

const ROOT = {
  coordinate: `${SPEC_KIND}:b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2:replaceable-event-snapshots`,
  pubkey: "b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2",
};

const PARENT = {
  id: "07a11d3c9bd67342c45b47c5584f8b1b79a39ea79c43253362d445e451cc0853",
  pubkey: "c21b1a6cdb247ccbd938dcb16b15a4fa382d00ffd7b12d5cbbad172a0cd4d170",
};

/** Enough of a signed event to parse, since parsing never checks a signature. */
const asEvent = (tags: string[][], content = "a comment", overrides = {}) => ({
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1_700_000_000,
  kind: COMMENT_KIND,
  tags,
  content,
  sig: "c".repeat(128),
  ...overrides,
});

describe("discussion fixtures", () => {
  it("are verbatim events, signatures intact", () => {
    const forged = discussionEvents.filter((event) => !verifyEvent(event));
    expect(forged.map((e) => e.id)).toEqual([]);
  });

  it("came from more than one client, which is the point of having them", () => {
    const clients = new Set(discussionEvents.map((event) => tagValue(event, "client") || "(none)"));
    expect(clients.size).toBeGreaterThan(3);
  });
});

describe("buildComment", () => {
  it("scopes a top level comment on the document with both cases of tag", () => {
    const draft = buildComment({ root: ROOT, content: "  why is this a MUST?  " });

    expect(draft.kind).toBe(COMMENT_KIND);
    expect(draft.content).toBe("why is this a MUST?");
    expect(draft.tags).toEqual([
      ["A", ROOT.coordinate],
      ["K", "30817"],
      ["P", ROOT.pubkey],
      ["a", ROOT.coordinate],
      ["k", "30817"],
      ["p", ROOT.pubkey],
      ["client", "Open Specs"],
    ]);
  });

  it("leaves a top level comment without an e tag, which is what makes it top level", () => {
    const draft = buildComment({ root: ROOT, content: "hello" });
    expect(draft.tags.some((tag) => tag[0] === "e")).toBe(false);
  });

  it("keeps the document as the root of a reply and moves only the lowercase set", () => {
    const draft = buildComment({ root: ROOT, parent: PARENT, content: "because of X" });

    expect(draft.tags).toEqual([
      ["A", ROOT.coordinate],
      ["K", "30817"],
      ["P", ROOT.pubkey],
      ["e", PARENT.id],
      ["k", "1111"],
      ["p", PARENT.pubkey],
      ["client", "Open Specs"],
    ]);
  });

  it("carries a relay hint on the parent when one is known", () => {
    const draft = buildComment({
      root: ROOT,
      parent: { ...PARENT, relay: "wss://relay.ditto.pub/" },
      content: "yes",
    });
    expect(draft.tags).toContainEqual(["e", PARENT.id, "wss://relay.ditto.pub/"]);
  });
});

describe("parseComment", () => {
  it("reads every fixture comment", () => {
    const comments = discussionEvents.filter((event) => event.kind === COMMENT_KIND);
    for (const event of comments) {
      const comment = parseComment(event);
      expect(comment, `fixture ${event.id} should parse`).not.toBeNull();
      if (comment?.rootCoordinate !== null) {
        expect(comment?.rootCoordinate).toMatch(/^30817:[0-9a-f]{64}:/);
      }
    }
  });

  /**
   * One fixture is a real reply carrying no root scope at all: no `A`, no `a`,
   * only a pointer at the comment it answers. Asked for by coordinate it does
   * not exist, which is why the second pass asks by parent id as well.
   */
  it("keeps a reply that names its parent but no document", () => {
    const rootless = discussionEvents
      .filter((event) => event.kind === COMMENT_KIND)
      .map(parseComment)
      .filter((comment) => comment !== null && comment.rootCoordinate === null);

    expect(rootless.length).toBeGreaterThan(0);
    for (const comment of rootless) expect(comment?.parentId).not.toBeNull();
  });

  it("round trips what buildComment produced", () => {
    const draft = buildComment({ root: ROOT, parent: PARENT, content: "because of X" });
    const comment = parseComment(asEvent(draft.tags, draft.content));

    expect(comment?.rootCoordinate).toBe(ROOT.coordinate);
    expect(comment?.parentId).toBe(PARENT.id);
  });

  it("refuses anything that is not a comment", () => {
    expect(parseComment(asEvent([], "hi", { kind: 1 }))).toBeNull();
    expect(parseComment(null)).toBeNull();
    expect(parseComment({ kind: COMMENT_KIND })).toBeNull();
  });

  it("refuses a comment with nothing in it", () => {
    expect(parseComment(asEvent([["A", ROOT.coordinate]], "   "))).toBeNull();
  });

  it("keeps a comment the size of the document it discusses, which is not its business", () => {
    const long = "x".repeat(40_000);
    expect(parseComment(asEvent([["A", ROOT.coordinate]], long))?.content).toBe(long);
  });

  it("reads a root scoped by revision rather than by coordinate", () => {
    const revision = "e".repeat(64);
    const comment = parseComment(
      asEvent([
        ["E", revision],
        ["K", "30817"],
      ]),
    );
    expect(comment?.rootEventId).toBe(revision);
    expect(comment?.rootCoordinate).toBeNull();
  });

  it("falls back to the lowercase a when a client scoped with that alone", () => {
    const comment = parseComment(asEvent([["a", ROOT.coordinate]]));
    expect(comment?.rootCoordinate).toBe(ROOT.coordinate);
  });

  describe("reads an e tag as the parent only when it names one", () => {
    it("takes it when the parent kind is a comment", () => {
      const comment = parseComment(
        asEvent([
          ["A", ROOT.coordinate],
          ["e", PARENT.id],
          ["k", "1111"],
        ]),
      );
      expect(comment?.parentId).toBe(PARENT.id);
    });

    it("drops it when the parent kind is the document, which is nostrhub's shape", () => {
      const comment = parseComment(
        asEvent([
          ["A", ROOT.coordinate],
          ["e", "874f2546171957f817b94625752f00c392ad6f523bd90d3b9d28339c1a76f87c"],
          ["a", ROOT.coordinate],
          ["k", "30817"],
        ]),
      );
      expect(comment?.parentId).toBeNull();
    });

    it("drops it when it repeats the E root, which is Amethyst's shape", () => {
      const revision = "e".repeat(64);
      const comment = parseComment(
        asEvent([
          ["A", ROOT.coordinate],
          ["E", revision],
          ["e", revision],
          ["k", "30817"],
        ]),
      );
      expect(comment?.parentId).toBeNull();
    });

    it("drops an event answering itself", () => {
      const comment = parseComment(
        asEvent([
          ["A", ROOT.coordinate],
          ["e", "a".repeat(64)],
          ["k", "1111"],
        ]),
      );
      expect(comment?.parentId).toBeNull();
    });
  });

  it("files every fixture that nostrhub calls top level as top level", () => {
    for (const event of discussionCase("nostrhub-top-level")) {
      expect(parseComment(event)?.parentId, `fixture ${event.id}`).toBeNull();
    }
    for (const event of discussionCase("amethyst-e-and-E")) {
      expect(parseComment(event)?.parentId, `fixture ${event.id}`).toBeNull();
    }
    for (const event of discussionCase("e-pointing-at-the-document")) {
      expect(parseComment(event)?.parentId, `fixture ${event.id}`).toBeNull();
    }
  });

  it("files every fixture nostrhub calls a reply as a reply", () => {
    for (const event of discussionCase("nostrhub-reply")) {
      expect(parseComment(event)?.parentId, `fixture ${event.id}`).not.toBeNull();
    }
  });
});

const parseAll = (events: unknown[]) =>
  events.map(parseComment).filter((comment) => comment !== null);

describe("threadComments", () => {
  it("threads a real conversation, keeping every comment somewhere", () => {
    const comments = parseAll(discussionCase("thread"));
    const roots = threadComments(comments);

    const count = (nodes: ReturnType<typeof threadComments>): number =>
      nodes.reduce((total, node) => total + 1 + count(node.replies), 0);

    expect(count(roots)).toBe(comments.length);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThan(comments.length);
  });

  it("reads oldest first, at every depth", () => {
    const roots = threadComments(parseAll(discussionCase("thread")));
    const ordered = (nodes: ReturnType<typeof threadComments>): void => {
      const times = nodes.map((node) => node.comment.createdAt);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const node of nodes) ordered(node.replies);
    };
    ordered(roots);
  });

  it("surfaces a reply whose parent never arrived rather than dropping it", () => {
    const orphan = parseComment(
      asEvent([
        ["A", ROOT.coordinate],
        ["e", "f".repeat(64)],
        ["k", "1111"],
      ]),
    );
    expect(orphan).not.toBeNull();
    const roots = threadComments(orphan === null ? [] : [orphan]);
    expect(roots).toHaveLength(1);
  });

  it("counts a comment served twice once", () => {
    const comments = parseAll(discussionCase("thread"));
    expect(threadComments([...comments, ...comments])).toEqual(threadComments(comments));
  });

  it("does not loop on a forged pair pointing at each other", () => {
    const first = parseComment(
      asEvent(
        [
          ["A", ROOT.coordinate],
          ["e", "2".repeat(64)],
          ["k", "1111"],
        ],
        "first",
        { id: "1".repeat(64) },
      ),
    );
    const second = parseComment(
      asEvent(
        [
          ["A", ROOT.coordinate],
          ["e", "1".repeat(64)],
          ["k", "1111"],
        ],
        "second",
        { id: "2".repeat(64), created_at: 1_700_000_001 },
      ),
    );

    const roots = threadComments([first, second].filter((c) => c !== null));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.replies).toHaveLength(1);
  });
});

describe("correspondents", () => {
  it("counts a key that wrote ten times once", () => {
    const comments = parseAll(discussionCase("thread"));
    const people = correspondents(comments);
    expect(new Set(people).size).toBe(people.length);
    expect(people.length).toBeLessThanOrEqual(comments.length);
  });
});
