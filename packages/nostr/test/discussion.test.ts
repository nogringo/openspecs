import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authorRelays,
  DISCUSSION_RELAYS,
  discussionFilters,
  fetchDiscussion,
  referenceFilters,
  sortDiscussion,
  subscribeDiscussion,
} from "../src/discussion";
import { SPEC_KIND } from "../src/event";
import { buildComment, COMMENT_KIND, threadComments } from "../src/nip22";
import { buildReaction, REACTION_KIND } from "../src/nip25";
import { clearRelayListCache } from "../src/nip65";
import { relaySet } from "../src/pool";
import { DEFAULT_RELAYS } from "../src/relay";
import { discussionCase, discussionEvents } from "./fixtures";

const authorKey = generateSecretKey();
const readerKey = generateSecretKey();
const author = getPublicKey(authorKey);

const ROOT = { coordinate: `${SPEC_KIND}:${author}:a-specification`, pubkey: author };
const SPEC_EVENT_ID = "d".repeat(64);
const OTHER = `${SPEC_KIND}:${author}:another-specification`;

const sign = (
  draft: { kind: number; content: string; tags: string[][] },
  key = readerKey,
  at = 1,
) => finalizeEvent({ ...draft, created_at: at }, key);

describe("discussionFilters", () => {
  it("asks for comments by every way a client scopes a root", () => {
    const filters = discussionFilters(ROOT.coordinate, SPEC_EVENT_ID);
    const comments = filters.filter((filter) => filter.kinds?.includes(COMMENT_KIND));

    expect(comments).toHaveLength(3);
    expect(comments[0]?.["#A"]).toEqual([ROOT.coordinate]);
    expect(comments[1]?.["#a"]).toEqual([ROOT.coordinate]);
    expect(comments[2]?.["#E"]).toEqual([SPEC_EVENT_ID]);
  });

  it("asks for reactions by coordinate and by event id both", () => {
    const filters = discussionFilters(ROOT.coordinate, SPEC_EVENT_ID);
    const reactions = filters.filter((filter) => filter.kinds?.includes(REACTION_KIND));

    expect(reactions.map((filter) => filter["#a"] ?? filter["#e"])).toEqual([
      [ROOT.coordinate],
      [SPEC_EVENT_ID],
    ]);
  });
});

describe("referenceFilters", () => {
  it("asks nothing when there is nothing to ask about", () => {
    expect(referenceFilters([])).toEqual([]);
  });

  it("asks for comments too, for the reply that names no document", () => {
    expect(referenceFilters(["a".repeat(64)])[0]?.kinds).toContain(COMMENT_KIND);
  });

  it("splits a long list rather than sending a filter a relay will refuse", () => {
    const ids = Array.from({ length: 450 }, (_, index) => String(index).padStart(64, "0"));
    const filters = referenceFilters(ids);

    expect(filters).toHaveLength(3);
    expect(filters.flatMap((filter) => filter["#e"] ?? [])).toEqual(ids);
  });

  it("asks about an id served by three relays once", () => {
    const id = "a".repeat(64);
    expect(referenceFilters([id, id, id])[0]?.["#e"]).toEqual([id]);
  });
});

describe("sortDiscussion", () => {
  it("sorts real events by what they are", () => {
    const sorted = sortDiscussion(discussionEvents, "");
    expect(sorted.comments).toHaveLength(0);
    expect(sorted.reactions.length).toBeGreaterThan(0);
    expect(sorted.zaps.length).toBeGreaterThan(0);
  });

  it("drops a comment answering a filter for this document but naming another", () => {
    const mine = sign(buildComment({ root: ROOT, content: "about this one" }));
    const theirs = sign(
      buildComment({ root: { coordinate: OTHER, pubkey: author }, content: "about that one" }),
    );

    const sorted = sortDiscussion([mine, theirs], ROOT.coordinate);
    expect(sorted.comments.map((comment) => comment.id)).toEqual([mine.id]);
  });

  it("keeps a reply naming no document when it answers a comment already here", () => {
    const parent = sign(buildComment({ root: ROOT, content: "the parent" }));
    const rootless = sign({
      kind: COMMENT_KIND,
      content: "a reply carrying no root scope at all",
      tags: [
        ["e", parent.id],
        ["k", "1111"],
        ["p", parent.pubkey],
      ],
    });

    expect(sortDiscussion([rootless], ROOT.coordinate).comments).toHaveLength(0);
    expect(
      sortDiscussion([rootless], ROOT.coordinate, { threadIds: new Set([parent.id]) }).comments,
    ).toHaveLength(1);
  });

  it("keeps a comment scoped by revision rather than by coordinate", () => {
    const scoped = sign({
      kind: COMMENT_KIND,
      content: "written against the revision that was live that day",
      tags: [
        ["E", SPEC_EVENT_ID],
        ["K", "30817"],
        ["P", author],
      ],
    });

    expect(sortDiscussion([scoped], ROOT.coordinate).comments).toHaveLength(0);
    expect(
      sortDiscussion([scoped], ROOT.coordinate, { specEventId: SPEC_EVENT_ID }).comments,
    ).toHaveLength(1);
  });

  it("counts an event served by two relays once", () => {
    const comment = sign(buildComment({ root: ROOT, content: "once" }));
    expect(sortDiscussion([comment, comment], ROOT.coordinate).comments).toHaveLength(1);
  });

  describe("a comment somebody took back", () => {
    const comment = sign(buildComment({ root: ROOT, content: "said in haste" }), readerKey);

    const deletion = (key: Uint8Array) =>
      sign(
        {
          kind: 5,
          content: "",
          tags: [
            ["e", comment.id],
            ["k", "1111"],
          ],
        },
        key,
      );

    /** Relays are not required to honour a kind 5, and a page is not required to wait. */
    it("is dropped, whether or not the relays honoured it", () => {
      expect(sortDiscussion([comment, deletion(readerKey)], ROOT.coordinate).comments).toEqual([]);
    });

    it("stays when the request came from somebody else", () => {
      expect(sortDiscussion([comment, deletion(authorKey)], ROOT.coordinate).comments).toHaveLength(
        1,
      );
    });

    it("is dropped whichever order the two arrived in", () => {
      expect(sortDiscussion([deletion(readerKey), comment], ROOT.coordinate).comments).toEqual([]);
    });
  });
});

describe("the author's own relays", () => {
  let known: MockRelay;
  let mine: MockRelay;
  let indexer: MockRelay;
  let pool: SimplePool;

  const onKnown = sign(
    buildComment({ root: ROOT, content: "posted where everyone looks" }),
    readerKey,
    10,
  );
  /** Only on the author's own relay, so it is only found by resolving their list. */
  const onMine = sign(
    buildComment({ root: ROOT, content: "posted to the author's inbox alone" }),
    readerKey,
    20,
  );

  beforeAll(async () => {
    known = createMockRelay();
    mine = createMockRelay();
    indexer = createMockRelay();
    await Promise.all([known.start(), mine.start(), indexer.start()]);

    known.seed([onKnown]);
    mine.seed([onMine]);
    indexer.seed([
      finalizeEvent(
        {
          kind: 10002,
          created_at: 1,
          content: "",
          tags: [["r", mine.url ?? ""]],
        },
        authorKey,
      ),
    ]);

    pool = new SimplePool();
  });

  afterAll(async () => {
    pool.destroy();
    clearRelayListCache();
    await Promise.all([known.stop(), mine.stop(), indexer.stop()]);
  });

  const pointer = () => ({ coordinate: ROOT.coordinate, specEventId: SPEC_EVENT_ID });

  /** The public defaults are replaced, so the only relays reached are the mocks. */
  const asking = () => ({
    pool,
    relays: [known.url ?? ""],
    indexers: [indexer.url ?? ""],
    timeoutMs: 1500,
  });

  it("reads a comment that only reached the author's NIP-65 relays", async () => {
    const discussion = await fetchDiscussion(pointer(), asking());

    expect(discussion.comments.map((comment) => comment.content).sort()).toEqual(
      [onKnown.content, onMine.content].sort(),
    );
  });

  it("stays on the relays it was given when the outbox is turned off", async () => {
    clearRelayListCache();
    const discussion = await fetchDiscussion(pointer(), { ...asking(), outbox: false });

    expect(discussion.comments.map((comment) => comment.content)).toEqual([onKnown.content]);
  });

  it("reads both sides of the list, since a comment lands on the inbox", async () => {
    clearRelayListCache();
    const relays = await authorRelays(author, { pool, indexers: [indexer.url ?? ""] });
    expect(relays).toContain(relaySet([mine.url ?? ""])[0]);
  });

  it("widens a subscription already running onto them", async () => {
    clearRelayListCache();
    const seen: string[] = [];
    const subscription = subscribeDiscussion(
      pointer(),
      (event) => seen.push(event.content),
      asking(),
    );

    try {
      // The known relay answers at once; the author's is only asked once their
      // list has been resolved, which is the whole point of widening.
      await vi.waitFor(() => expect(seen).toContain(onKnown.content), { timeout: 2000 });
      await vi.waitFor(() => expect(seen).toContain(onMine.content), { timeout: 2000 });
    } finally {
      subscription.close();
    }
  });

  it("opens nothing more on a subscription already closed", async () => {
    clearRelayListCache();
    const seen: string[] = [];
    subscribeDiscussion(pointer(), (event) => seen.push(event.content), asking()).close();

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(seen).not.toContain(onMine.content);
  });
});

describe("fetchDiscussion", () => {
  let relay: MockRelay;
  let pool: SimplePool;

  const parent = sign(buildComment({ root: ROOT, content: "the parent" }), readerKey, 10);
  const reply = sign(
    buildComment({
      root: ROOT,
      parent: { id: parent.id, pubkey: parent.pubkey },
      content: "the reply",
    }),
    authorKey,
    20,
  );
  /** Only reachable through the parent's id, which is the whole point of the second pass. */
  const onComment = sign(
    buildReaction({ id: parent.id, pubkey: parent.pubkey, kind: COMMENT_KIND }),
    authorKey,
    30,
  );
  const onDocument = sign(
    buildReaction({
      id: SPEC_EVENT_ID,
      pubkey: author,
      kind: SPEC_KIND,
      coordinate: ROOT.coordinate,
    }),
    readerKey,
    40,
  );

  beforeAll(async () => {
    relay = createMockRelay();
    await relay.start();
    relay.seed([parent, reply, onComment, onDocument]);
    pool = new SimplePool();
  });

  afterAll(() => {
    pool.destroy();
    return relay.stop();
  });

  it("returns the conversation, including what only the second pass can reach", async () => {
    const discussion = await fetchDiscussion(
      { coordinate: ROOT.coordinate, specEventId: SPEC_EVENT_ID },
      { pool, relays: [relay.url ?? ""], timeoutMs: 1500, outbox: false },
    );

    expect(discussion.comments.map((comment) => comment.id).sort()).toEqual(
      [parent.id, reply.id].sort(),
    );
    expect(discussion.reactions.map((reaction) => reaction.id).sort()).toEqual(
      [onComment.id, onDocument.id].sort(),
    );
  });

  it("threads what it returned the way the record reads", async () => {
    const discussion = await fetchDiscussion(
      { coordinate: ROOT.coordinate, specEventId: SPEC_EVENT_ID },
      { pool, relays: [relay.url ?? ""], timeoutMs: 1500, outbox: false },
    );
    const roots = threadComments(discussion.comments);

    expect(roots).toHaveLength(1);
    expect(roots[0]?.comment.id).toBe(parent.id);
    expect(roots[0]?.replies.map((node) => node.comment.id)).toEqual([reply.id]);
  });
});

describe("the fixtures thread as the other clients thread them", () => {
  it("keeps every comment of the busiest real thread", () => {
    const events = discussionCase("thread");
    const coordinate = events[0]?.tags.find((tag) => tag[0] === "A" || tag[0] === "a")?.[1] ?? "";
    const discussion = sortDiscussion(events, coordinate);

    expect(discussion.comments).toHaveLength(events.length);
    const roots = threadComments(discussion.comments);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThan(events.length);
  });
});

describe("where a conversation is read from", () => {
  /** Records what it was asked and answers nothing, so only the relay set is under test. */
  const recordingPool = () => {
    const asked: string[] = [];
    return {
      asked,
      pool: {
        querySync: async (relays: string[]) => {
          asked.push(...relays);
          return [];
        },
      } as unknown as SimplePool,
    };
  };

  it("asks every relay this app sends a comment to", async () => {
    const { asked, pool } = recordingPool();
    await fetchDiscussion(
      { coordinate: ROOT.coordinate, specEventId: SPEC_EVENT_ID },
      { pool, outbox: false },
    );

    // `writeRelays` sends a comment to both lists. Reading only the first is how
    // a comment ends up counted in a notification and missing from the page it
    // is about, which is what this asserts can no longer happen.
    // Compared through `relaySet`, which is what normalises them on the way out.
    for (const relay of relaySet(DISCUSSION_RELAYS, DEFAULT_RELAYS)) {
      expect(asked).toContain(relay);
    }
  });

  it("lets a caller name its own relays instead, the way everything else here does", async () => {
    const { asked, pool } = recordingPool();
    await fetchDiscussion(
      { coordinate: ROOT.coordinate, specEventId: SPEC_EVENT_ID },
      { pool, outbox: false, relays: ["wss://only.example"] },
    );
    expect([...new Set(asked)]).toEqual(relaySet(["wss://only.example"]));
  });
});
