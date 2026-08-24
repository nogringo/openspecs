import { describe, expect, it } from "vitest";
import { SPEC_KIND } from "../src/event";
import {
  buildReaction,
  buildRetraction,
  DELETION_KIND,
  LIKE,
  parseDeletion,
  parseReaction,
  REACTION_KIND,
  tallyReactions,
} from "../src/nip25";
import { discussionCase } from "./fixtures";

const COORDINATE = `${SPEC_KIND}:b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2:replaceable-event-snapshots`;

const SPEC = {
  id: "d".repeat(64),
  pubkey: "b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2",
  kind: SPEC_KIND,
  coordinate: COORDINATE,
};

const COMMENT = { id: "e".repeat(64), pubkey: "f".repeat(64), kind: 1111 };

const asReaction = (content: string, pubkey: string, overrides = {}) => ({
  id: `${pubkey.slice(0, 8)}${content.charCodeAt(0) || 0}`.padEnd(64, "0"),
  pubkey,
  created_at: 1_700_000_000,
  kind: REACTION_KIND,
  tags: [["e", SPEC.id]],
  content,
  sig: "c".repeat(128),
  ...overrides,
});

describe("buildReaction", () => {
  it("carries both the event id and the coordinate on a document", () => {
    expect(buildReaction(SPEC).tags).toEqual([
      ["e", SPEC.id],
      ["a", COORDINATE],
      ["p", SPEC.pubkey],
      ["k", "30817"],
      ["client", "Open Specs"],
    ]);
  });

  it("carries no coordinate on a comment, which has none", () => {
    expect(buildReaction(COMMENT).tags).toEqual([
      ["e", COMMENT.id],
      ["p", COMMENT.pubkey],
      ["k", "1111"],
      ["client", "Open Specs"],
    ]);
  });

  it("defaults to a like and takes any other symbol", () => {
    expect(buildReaction(COMMENT).content).toBe(LIKE);
    expect(buildReaction(COMMENT, "🔥").content).toBe("🔥");
  });
});

describe("buildRetraction", () => {
  it("names the reaction and its kind, as NIP-09 asks", () => {
    expect(buildRetraction("a".repeat(64))).toEqual({
      kind: DELETION_KIND,
      content: "",
      tags: [
        ["e", "a".repeat(64)],
        ["k", "7"],
        ["client", "Open Specs"],
      ],
    });
  });
});

describe("parseReaction", () => {
  it("reads every fixture reaction", () => {
    for (const event of [
      ...discussionCase("reactions-on-documents"),
      ...discussionCase("reactions-on-comments"),
    ]) {
      const reaction = parseReaction(event);
      expect(reaction, `fixture ${event.id} should parse`).not.toBeNull();
      expect(reaction?.symbol).not.toBe("");
    }
  });

  it("reads an empty reaction as a like, which is what the oldest clients sent", () => {
    expect(parseReaction(asReaction("", "1".repeat(64)))?.symbol).toBe(LIKE);
  });

  it("keeps a paragraph wearing a reaction's clothes, for the chip to deal with", () => {
    const long = "x".repeat(200);
    expect(parseReaction(asReaction(long, "1".repeat(64)))?.symbol).toBe(long);
  });

  it("resolves a NIP-30 shortcode to its image, https only", () => {
    const withEmoji = asReaction(":ostrich:", "1".repeat(64), {
      tags: [
        ["e", SPEC.id],
        ["emoji", "ostrich", "https://example.com/ostrich.png"],
      ],
    });
    expect(parseReaction(withEmoji)?.emojiUrl).toBe("https://example.com/ostrich.png");

    const insecure = asReaction(":ostrich:", "1".repeat(64), {
      tags: [
        ["e", SPEC.id],
        ["emoji", "ostrich", "http://example.com/ostrich.png"],
      ],
    });
    expect(parseReaction(insecure)?.emojiUrl).toBeNull();
  });
});

describe("parseDeletion", () => {
  it("collects the ids a deletion names", () => {
    expect(
      parseDeletion({
        id: "a".repeat(64),
        pubkey: "b".repeat(64),
        created_at: 1,
        kind: DELETION_KIND,
        tags: [
          ["e", "1".repeat(64)],
          ["e", "2".repeat(64)],
          ["k", "7"],
        ],
        content: "",
        sig: "c".repeat(128),
      })?.ids,
    ).toEqual(["1".repeat(64), "2".repeat(64)]);
  });

  it("refuses a deletion that names nothing", () => {
    expect(
      parseDeletion({
        id: "a".repeat(64),
        pubkey: "b".repeat(64),
        created_at: 1,
        kind: DELETION_KIND,
        tags: [["k", "7"]],
        content: "",
        sig: "c".repeat(128),
      }),
    ).toBeNull();
  });
});

describe("tallyReactions", () => {
  const alice = "1".repeat(64);
  const bob = "2".repeat(64);

  const parseAll = (events: unknown[]) =>
    events.map(parseReaction).filter((reaction) => reaction !== null);

  it("counts one reader once, however many times their client resent it", () => {
    const reactions = parseAll([
      asReaction(LIKE, alice, { id: "a".repeat(64), created_at: 10 }),
      asReaction(LIKE, alice, { id: "b".repeat(64), created_at: 20 }),
      asReaction(LIKE, bob, { id: "c".repeat(64) }),
    ]);

    const [tally] = tallyReactions(reactions);
    expect(tally?.count).toBe(2);
    // The newest is the one a retraction has to name.
    expect(tally?.by[alice]).toBe("b".repeat(64));
  });

  it("counts a reader's like and their emoji as two different things", () => {
    const tallies = tallyReactions(
      parseAll([
        asReaction(LIKE, alice, { id: "a".repeat(64) }),
        asReaction("🔥", alice, { id: "b".repeat(64) }),
      ]),
    );
    expect(tallies.map((tally) => tally.symbol)).toEqual([LIKE, "🔥"]);
  });

  it("drops a reaction its own author retracted", () => {
    const reactions = parseAll([
      asReaction(LIKE, alice, { id: "a".repeat(64) }),
      asReaction(LIKE, bob, { id: "b".repeat(64) }),
    ]);
    const tallies = tallyReactions(reactions, [{ pubkey: alice, ids: ["a".repeat(64)] }]);

    expect(tallies[0]?.count).toBe(1);
    expect(tallies[0]?.by[alice]).toBeUndefined();
  });

  it("ignores a deletion naming somebody else's reaction", () => {
    const reactions = parseAll([asReaction(LIKE, alice, { id: "a".repeat(64) })]);
    expect(tallyReactions(reactions, [{ pubkey: bob, ids: ["a".repeat(64)] }])[0]?.count).toBe(1);
  });

  it("puts the most reacted first, and a like ahead of an equal emoji", () => {
    const tallies = tallyReactions(
      parseAll([
        asReaction("🔥", alice, { id: "a".repeat(64) }),
        asReaction(LIKE, bob, { id: "b".repeat(64) }),
      ]),
    );
    expect(tallies.map((tally) => tally.symbol)).toEqual([LIKE, "🔥"]);
  });
});
