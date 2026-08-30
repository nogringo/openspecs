import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { toCoordinate } from "../src/address";
import { type NostrEvent, SPEC_KIND } from "../src/event";
import { buildComment, COMMENT_KIND } from "../src/nip22";
import { buildReaction, buildRetraction, DELETION_KIND, REACTION_KIND } from "../src/nip25";
import { buildZapRequest, ZAP_RECEIPT_KIND } from "../src/nip57";
import {
  copyFilters,
  MAX_NOTICES,
  type Notice,
  namedFilters,
  notificationFilters,
  sortNotices,
  targetFilters,
  unnamedTargets,
} from "../src/notifications";
import { parseSpec, type Spec } from "../src/spec";
import { MAX_IDS_PER_FILTER } from "../src/subscribe";

const mySecret = generateSecretKey();
const ME = getPublicKey(mySecret);

const theirSecret = generateSecretKey();
const THEM = getPublicKey(theirSecret);

const thirdSecret = generateSecretKey();
const THIRD = getPublicKey(thirdSecret);

const MINE = { coordinate: `${SPEC_KIND}:${ME}:nip-07`, pubkey: ME };
const THEIRS = { coordinate: `${SPEC_KIND}:${THEM}:nip-46`, pubkey: THEM };

const sign = (
  draft: { kind: number; content: string; tags: string[][] },
  secret: Uint8Array,
  at = 100,
) => finalizeEvent({ ...draft, created_at: at }, secret) as NostrEvent;

const comment = (
  root: { coordinate: string; pubkey: string },
  by: Uint8Array,
  options: { parent?: { id: string; pubkey: string }; content?: string; at?: number } = {},
) =>
  sign(
    buildComment({ root, parent: options.parent ?? null, content: options.content ?? "a note" }),
    by,
    options.at ?? 100,
  );

const reaction = (
  target: { id: string; pubkey: string; kind: number; coordinate?: string },
  by: Uint8Array,
  options: { symbol?: string; at?: number } = {},
) => sign(buildReaction(target, options.symbol ?? "+"), by, options.at ?? 100);

/** A real invoice for 21 satoshis, so the amount is read rather than asserted. */
const INVOICE_21_SATS =
  "lnbc210n1pn2s396pp5w7lqvvmqxxwqmqjqxqyjqxqyjqxqyjqxqyjqxqyjqxqyjqxqyjqsdqqcqzzsxqyz5vqsp5usqfaketc5sg7g7fhqg9zqhqvqhqvqhqvqhqvqhqvqhqvqhqvqhqs9qyyssq";

const serverSecret = generateSecretKey();

const zap = (
  by: Uint8Array,
  target: { pubkey: string; coordinate?: string; eventId?: string },
  at = 100,
) => {
  const request = sign(
    buildZapRequest({ target, amountMsats: 21_000, relays: ["wss://nos.lol"] }),
    by,
    at,
  );
  return sign(
    {
      kind: ZAP_RECEIPT_KIND,
      content: "",
      tags: [
        ["p", target.pubkey],
        ["bolt11", INVOICE_21_SATS],
        ["description", JSON.stringify(request)],
        // Copied off the request, which is what NIP-57 asks a paying server to
        // do and what the receipt is read by.
        ...(target.coordinate ? [["a", target.coordinate]] : []),
        ...(target.eventId ? [["e", target.eventId]] : []),
      ],
    },
    serverSecret,
    at,
  );
};

const specEvent = (by: Uint8Array, identifier: string, content = "# A copy", at = 100) =>
  sign(
    {
      kind: SPEC_KIND,
      content,
      tags: [
        ["d", identifier],
        ["title", "A copy"],
      ],
    },
    by,
    at,
  );

const asSpec = (event: NostrEvent): Spec => {
  const spec = parseSpec(event);
  if (spec === null) throw new Error("fixture is not a specification");
  return spec;
};

const kinds = (notices: Notice[]) => notices.map((notice) => notice.kind);

describe("notificationFilters", () => {
  it("never asks for a zap receipt by the tag that names the payer", () => {
    const zaps = notificationFilters(ME).filter((filter) =>
      filter.kinds?.includes(ZAP_RECEIPT_KIND),
    );
    expect(zaps).toHaveLength(1);
    expect(zaps[0]?.["#P"]).toBeUndefined();
    expect(zaps[0]?.["#p"]).toEqual([ME]);
  });

  it("asks for comments both ways, since a reply under my document names me in `P` alone", () => {
    const comments = notificationFilters(ME).filter((filter) =>
      filter.kinds?.includes(COMMENT_KIND),
    );
    expect(comments.map((filter) => (filter["#p"] ? "#p" : "#P"))).toEqual(["#p", "#P"]);
  });

  it("gives each kind its own limit, so reactions cannot crowd out the rest", () => {
    const filters = notificationFilters(ME);
    const reactions = filters.find((filter) => filter.kinds?.includes(REACTION_KIND));
    expect(filters.every((filter) => typeof filter.limit === "number")).toBe(true);
    expect(reactions?.kinds).toEqual([REACTION_KIND]);
  });
});

describe("copyFilters and targetFilters", () => {
  const many = Array.from({ length: MAX_IDS_PER_FILTER + 5 }, (_, index) => `name-${index}`);

  it("chunk what a relay would refuse in one filter", () => {
    const filters = copyFilters(many);
    expect(filters).toHaveLength(2);
    expect(filters[0]?.["#d"]).toHaveLength(MAX_IDS_PER_FILTER);
    expect(filters[1]?.["#d"]).toHaveLength(5);
  });

  it("drop a name repeated in the list", () => {
    expect(copyFilters(["nip-07", "nip-07"])[0]?.["#d"]).toEqual(["nip-07"]);
  });

  it("ask only about deletions, not about the conversation around them", () => {
    expect(targetFilters(["a".repeat(64)])).toEqual([
      { kinds: [DELETION_KIND], "#e": ["a".repeat(64)] },
    ]);
  });
});

describe("sortNotices, comments", () => {
  it("takes a comment on my document as a comment", () => {
    const notices = sortNotices([comment(MINE, theirSecret)], { me: ME });
    expect(kinds(notices)).toEqual(["comment"]);
    expect(notices[0]?.pubkey).toBe(THEM);
    expect(notices[0]?.document).toEqual({
      pubkey: ME,
      identifier: "nip-07",
      coordinate: MINE.coordinate,
    });
  });

  it("takes an answer to something I wrote as a reply, wherever it was written", () => {
    const mine = comment(THEIRS, mySecret);
    const notices = sortNotices(
      [comment(THEIRS, thirdSecret, { parent: { id: mine.id, pubkey: ME } })],
      {
        me: ME,
      },
    );
    expect(kinds(notices)).toEqual(["reply"]);
    expect(notices[0]?.document.pubkey).toBe(THEM);
    expect(notices[0]?.targetId).toBe(mine.id);
  });

  it("takes two other people talking under my document as a thread", () => {
    const theirs = comment(MINE, theirSecret);
    const notices = sortNotices(
      [comment(MINE, thirdSecret, { parent: { id: theirs.id, pubkey: THEM } })],
      { me: ME },
    );
    expect(kinds(notices)).toEqual(["thread"]);
    expect(notices[0]?.pubkey).toBe(THIRD);
  });

  it("drops what I wrote myself", () => {
    expect(sortNotices([comment(MINE, mySecret)], { me: ME })).toEqual([]);
  });

  it("drops a comment that names me in neither tag, which a relay cannot check", () => {
    expect(sortNotices([comment(THEIRS, thirdSecret)], { me: ME })).toEqual([]);
  });

  it("drops a comment whose root coordinate is junk", () => {
    const junk = sign(
      {
        kind: COMMENT_KIND,
        content: "hello",
        tags: [
          ["A", "not-a-coordinate"],
          ["p", ME],
        ],
      },
      theirSecret,
    );
    expect(sortNotices([junk], { me: ME })).toEqual([]);
  });
});

describe("sortNotices, reactions", () => {
  const target = { id: "a".repeat(64), pubkey: ME, kind: SPEC_KIND, coordinate: MINE.coordinate };

  it("takes a reaction to my document, with its symbol", () => {
    const notices = sortNotices([reaction(target, theirSecret, { symbol: "🔥" })], { me: ME });
    expect(kinds(notices)).toEqual(["reaction"]);
    expect(notices[0]?.content).toBe("🔥");
  });

  it("drops a reaction to my own document from me", () => {
    expect(sortNotices([reaction(target, mySecret)], { me: ME })).toEqual([]);
  });

  it("drops a reaction naming me on a document that is not mine", () => {
    const theirs = {
      id: "b".repeat(64),
      pubkey: ME,
      kind: SPEC_KIND,
      coordinate: THEIRS.coordinate,
    };
    expect(sortNotices([reaction(theirs, theirSecret)], { me: ME })).toEqual([]);
  });

  it("drops a reaction that names only an event id, until its target is resolved", () => {
    const onComment = { id: "c".repeat(64), pubkey: ME, kind: COMMENT_KIND };
    expect(sortNotices([reaction(onComment, theirSecret)], { me: ME })).toEqual([]);
  });

  it("collapses the same like sent twice into one row, keeping the newer", () => {
    const first = reaction(target, theirSecret, { at: 100 });
    const second = reaction(target, theirSecret, { at: 200 });
    const notices = sortNotices([first, second], { me: ME });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.createdAt).toBe(200);
  });

  it("keeps two different symbols from the same key apart", () => {
    const like = reaction(target, theirSecret, { symbol: "+" });
    const fire = reaction(target, theirSecret, { symbol: "🔥" });
    expect(sortNotices([like, fire], { me: ME })).toHaveLength(2);
  });

  it("keeps the same symbol from two keys apart", () => {
    const one = reaction(target, theirSecret);
    const two = reaction(target, thirdSecret);
    expect(sortNotices([one, two], { me: ME })).toHaveLength(2);
  });
});

describe("sortNotices, zaps", () => {
  it("names who paid rather than the server that signed the receipt", () => {
    const receipt = zap(theirSecret, { pubkey: ME, coordinate: MINE.coordinate });
    const notices = sortNotices([receipt], { me: ME });
    expect(kinds(notices)).toEqual(["zap"]);
    expect(notices[0]?.pubkey).toBe(THEM);
    expect(notices[0]?.sats).toBe(21);
  });

  it("drops a zap I sent myself", () => {
    const receipt = zap(mySecret, { pubkey: ME, coordinate: MINE.coordinate });
    expect(sortNotices([receipt], { me: ME })).toEqual([]);
  });

  it("drops a receipt addressed to somebody else", () => {
    const receipt = zap(thirdSecret, { pubkey: THEM, coordinate: THEIRS.coordinate });
    expect(sortNotices([receipt], { me: ME })).toEqual([]);
  });
});

describe("sortNotices, retractions", () => {
  it("drops a comment its own author asked to be forgotten", () => {
    const written = comment(MINE, theirSecret);
    const taken = sign(buildRetraction(written.id), theirSecret);
    expect(sortNotices([written, taken], { me: ME })).toEqual([]);
  });

  it("keeps one somebody else asked to have forgotten", () => {
    const written = comment(MINE, theirSecret);
    const taken = sign(buildRetraction(written.id), thirdSecret);
    expect(sortNotices([written, taken], { me: ME })).toHaveLength(1);
  });
});

describe("sortNotices, copies", () => {
  it("takes another key publishing under one of my names, and leads to their copy", () => {
    const copy = asSpec(specEvent(theirSecret, "nip-07"));
    const notices = sortNotices([], { me: ME, copies: [copy] });
    expect(kinds(notices)).toEqual(["copy"]);
    expect(notices[0]?.document).toEqual({
      pubkey: THEM,
      identifier: "nip-07",
      coordinate: toCoordinate(copy),
    });
  });

  it("drops my own document and a blank one", () => {
    const own = asSpec(specEvent(mySecret, "nip-07"));
    const blank = asSpec(specEvent(theirSecret, "nip-07", ""));
    expect(sortNotices([], { me: ME, copies: [own, blank] })).toEqual([]);
  });
});

describe("sortNotices, muted", () => {
  const NONE = new Set<string>();
  const muted = (
    partial: Partial<{ pubkeys: Set<string>; eventIds: Set<string>; coordinates: Set<string> }>,
  ) => ({
    pubkeys: NONE,
    eventIds: NONE,
    coordinates: NONE,
    ...partial,
  });

  it("drops what a muted key did, and keeps the rest", () => {
    const theirs = comment(MINE, theirSecret, { content: "theirs" });
    const thirds = comment(MINE, thirdSecret, { content: "thirds" });
    const notices = sortNotices([theirs, thirds], {
      me: ME,
      muted: muted({ pubkeys: new Set([THEM]) }),
    });
    expect(notices.map((notice) => notice.id)).toEqual([thirds.id]);
  });

  it("drops a muted event by its id", () => {
    const one = comment(MINE, theirSecret);
    expect(sortNotices([one], { me: ME, muted: muted({ eventIds: new Set([one.id]) }) })).toEqual(
      [],
    );
  });

  it("drops everything under a muted document", () => {
    const under = comment(MINE, theirSecret);
    const scope = { me: ME, muted: muted({ coordinates: new Set([MINE.coordinate]) }) };
    expect(sortNotices([under], scope)).toEqual([]);
  });

  it("drops a muted like before the collapse, so it is not the one kept", () => {
    const target = { id: "a".repeat(64), pubkey: ME, kind: SPEC_KIND, coordinate: MINE.coordinate };
    const kept = reaction(target, thirdSecret, { at: 100 });
    const scope = { me: ME, muted: muted({ pubkeys: new Set([THEM]) }) };
    const notices = sortNotices([kept, reaction(target, theirSecret, { at: 200 })], scope);
    expect(notices.map((notice) => notice.id)).toEqual([kept.id]);
  });

  it("still stops at one page after the muted rows are gone", () => {
    const many = Array.from({ length: MAX_NOTICES + 10 }, (_, index) =>
      comment(MINE, index % 2 === 0 ? theirSecret : thirdSecret, {
        at: 100 + index,
        content: `note ${index}`,
      }),
    );
    const scope = { me: ME, muted: muted({ pubkeys: new Set([THEM]) }) };
    const notices = sortNotices(many, scope);
    expect(notices).toHaveLength((MAX_NOTICES + 10) / 2);
    expect(notices.every((notice) => notice.pubkey === THIRD)).toBe(true);
  });
});

describe("sortNotices, the whole list", () => {
  it("takes the same event served by three relays as one row", () => {
    const one = comment(MINE, theirSecret);
    expect(sortNotices([one, one, one], { me: ME })).toHaveLength(1);
  });

  it("reads newest first, with the lower id breaking a tie", () => {
    const old = comment(MINE, theirSecret, { at: 100, content: "old" });
    const a = comment(MINE, theirSecret, { at: 200, content: "a" });
    const b = comment(MINE, thirdSecret, { at: 200, content: "b" });
    const [first, second, third] = sortNotices([old, a, b], { me: ME });

    expect(third?.createdAt).toBe(100);
    expect([first?.id, second?.id].sort()).toEqual([a.id, b.id].sort());
    expect(first?.id).toBe(a.id < b.id ? a.id : b.id);
  });

  it("stops at what one page of news can be", () => {
    const many = Array.from({ length: MAX_NOTICES + 10 }, (_, index) =>
      comment(MINE, theirSecret, { at: 100 + index, content: `note ${index}` }),
    );
    expect(sortNotices(many, { me: ME })).toHaveLength(MAX_NOTICES);
  });
});

describe("reactions and zaps that name only an event id", () => {
  /** A comment I wrote on somebody else's document, which is what gets answered. */
  const myComment = comment(THEIRS, mySecret, { content: "a point of mine" });
  const onIt = { id: myComment.id, pubkey: ME, kind: COMMENT_KIND };

  it("asks about an id nothing here explains", () => {
    const events = [reaction(onIt, theirSecret)];
    expect(unnamedTargets(events)).toEqual([myComment.id]);
  });

  it("stops asking once the event is held", () => {
    expect(unnamedTargets([reaction(onIt, theirSecret), myComment])).toEqual([]);
  });

  it("asks nothing about a reaction that named a coordinate", () => {
    const onDocument = {
      id: "a".repeat(64),
      pubkey: ME,
      kind: SPEC_KIND,
      coordinate: MINE.coordinate,
    };
    expect(unnamedTargets([reaction(onDocument, theirSecret)])).toEqual([]);
  });

  it("asks for the events themselves, chunked", () => {
    expect(namedFilters([myComment.id])).toEqual([{ ids: [myComment.id] }]);
  });

  it("draws the reaction once the comment turns out to be mine", () => {
    const notices = sortNotices([reaction(onIt, theirSecret), myComment], { me: ME });
    expect(kinds(notices)).toEqual(["reaction"]);
    // The document is the one my comment hangs from, which is somebody else's.
    expect(notices[0]?.document.pubkey).toBe(THEM);
    expect(notices[0]?.onComment).toBe(true);
    expect(notices[0]?.targetId).toBe(myComment.id);
  });

  it("keeps dropping it when the comment turns out to be somebody else's", () => {
    const theirComment = comment(THEIRS, thirdSecret);
    const onTheirs = { id: theirComment.id, pubkey: ME, kind: COMMENT_KIND };
    expect(sortNotices([reaction(onTheirs, theirSecret), theirComment], { me: ME })).toEqual([]);
  });

  it("does the same for a zap on a comment of mine", () => {
    const receipt = zap(theirSecret, { pubkey: ME, eventId: myComment.id });
    const notices = sortNotices([receipt, myComment], { me: ME });
    expect(kinds(notices)).toEqual(["zap"]);
    expect(notices[0]?.onComment).toBe(true);
    expect(notices[0]?.sats).toBe(21);
  });

  it("marks a reaction on a document of mine as not being on a comment", () => {
    const onDocument = {
      id: "a".repeat(64),
      pubkey: ME,
      kind: SPEC_KIND,
      coordinate: MINE.coordinate,
    };
    expect(sortNotices([reaction(onDocument, theirSecret)], { me: ME })[0]?.onComment).toBe(false);
  });
});
