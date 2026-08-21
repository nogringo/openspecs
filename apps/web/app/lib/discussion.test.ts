import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => {
  const real = { subscribeDiscussion: vi.fn(), subscribeReferences: vi.fn() };
  return real;
});

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  ...nostr,
}));

import { buildComment, buildReaction, type NostrEvent, SPEC_KIND } from "@openspecs/nostr";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  clearDiscussion,
  discussionState,
  startDiscussion,
  subscribeDiscussionState,
} from "./discussion";

const authorKey = generateSecretKey();
const readerKey = generateSecretKey();
const author = getPublicKey(authorKey);

const ROOT = { coordinate: `${SPEC_KIND}:${author}:a-specification`, pubkey: author };
const SPEC_EVENT_ID = "d".repeat(64);
const POINTER = { coordinate: ROOT.coordinate, specEventId: SPEC_EVENT_ID };

const comment = (content: string, at: number) =>
  finalizeEvent({ ...buildComment({ root: ROOT, content }), created_at: at }, readerKey);

const deletion = (id: string, at: number) =>
  finalizeEvent(
    {
      kind: 5,
      content: "",
      tags: [
        ["e", id],
        ["k", "1111"],
      ],
      created_at: at,
    },
    readerKey,
  );

/** The two subscriptions, held so a test can play the relays' part by hand. */
type Channel = { send: (event: NostrEvent) => void; eose: () => void };

let main: Channel;
let references: Channel[];

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.useFakeTimers();
  clearDiscussion();
  references = [];

  nostr.subscribeDiscussion.mockImplementation((_pointer, onEvent, options) => {
    main = { send: onEvent, eose: () => options?.onEose?.() };
    return { close: vi.fn() };
  });
  nostr.subscribeReferences.mockImplementation((_pointer, _ids, onEvent, options) => {
    references.push({ send: onEvent, eose: () => options?.onEose?.() });
    return { close: vi.fn() };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The store batches, so nothing it was told is visible until its timer runs. */
const settleTimers = async () => {
  await vi.advanceTimersByTimeAsync(200);
};

describe("startDiscussion", () => {
  it("opens on loading, with nothing of its own to show", () => {
    startDiscussion(POINTER);
    expect(discussionState()).toMatchObject({ coordinate: ROOT.coordinate, status: "loading" });
  });

  it("tells whoever is listening", () => {
    const heard = vi.fn();
    subscribeDiscussionState(heard);
    startDiscussion(POINTER);
    expect(heard).toHaveBeenCalled();
  });
});

/**
 * The rule this whole file exists for. A retraction can only be asked for by the
 * id of what it takes back, so it always lands one round trip behind the comment
 * it concerns. Reading the record before that answer is reading something about
 * to be taken away, which shows up as comments flashing on and off.
 */
describe("what the record waits for", () => {
  it("stays loading while the second pass has not answered", async () => {
    startDiscussion(POINTER);
    main.send(comment("said in haste", 10));
    main.eose();
    await settleTimers();

    expect(references).toHaveLength(1);
    expect(discussionState().status).toBe("loading");
    expect(discussionState().count).toBe(1);
  });

  it("reads as ready once it has", async () => {
    startDiscussion(POINTER);
    const said = comment("said in haste", 10);
    main.send(said);
    main.eose();
    await settleTimers();

    references[0]?.eose();
    await settleTimers();
    expect(discussionState().status).toBe("ready");
  });

  it("never shows a comment that the second pass takes back", async () => {
    startDiscussion(POINTER);
    const said = comment("said in haste", 10);
    main.send(said);
    main.eose();
    await settleTimers();

    // The retraction arrives on the second pass, before the answer that ends it.
    references[0]?.send(deletion(said.id, 20));
    references[0]?.eose();
    await settleTimers();

    expect(discussionState().status).toBe("ready");
    expect(discussionState().count).toBe(0);
  });

  /** An empty conversation has nothing to ask twice about, and must not hang. */
  it("settles an empty conversation once the relays go quiet", async () => {
    startDiscussion(POINTER);
    main.eose();
    await settleTimers();
    expect(discussionState().status).toBe("loading");

    await vi.advanceTimersByTimeAsync(600);
    expect(discussionState().status).toBe("ready");
    expect(references).toHaveLength(0);
  });

  /**
   * One relay finishing first is not the conversation being empty, which is why
   * the quiet window restarts on every event rather than running once.
   */
  it("does not call it empty while events are still arriving", async () => {
    startDiscussion(POINTER);
    main.eose();
    await vi.advanceTimersByTimeAsync(400);

    main.send(comment("late, from a slower relay", 10));
    await settleTimers();

    expect(discussionState().count).toBe(1);
    expect(discussionState().status).toBe("loading");
    references[0]?.eose();
    await settleTimers();
    expect(discussionState().status).toBe("ready");
  });

  it("gives up waiting rather than hiding the record forever", async () => {
    startDiscussion(POINTER);
    main.send(comment("said in haste", 10));
    main.eose();
    await settleTimers();
    expect(discussionState().status).toBe("loading");

    // The second pass never answers, which a silent relay is entitled to do.
    await vi.advanceTimersByTimeAsync(5000);
    expect(discussionState().status).toBe("ready");
    expect(discussionState().count).toBe(1);
  });
});

describe("what it counts", () => {
  it("tallies a reaction on the document by its coordinate", async () => {
    startDiscussion(POINTER);
    main.send(
      finalizeEvent(
        {
          ...buildReaction({
            id: SPEC_EVENT_ID,
            pubkey: author,
            kind: SPEC_KIND,
            coordinate: ROOT.coordinate,
          }),
          created_at: 10,
        },
        readerKey,
      ),
    );
    main.eose();
    await vi.advanceTimersByTimeAsync(600);

    expect(discussionState().document.reactions[0]).toMatchObject({ symbol: "+", count: 1 });
  });

  it("keeps a reply under the comment it answers", async () => {
    startDiscussion(POINTER);
    const parent = comment("the parent", 10);
    main.send(parent);
    main.send(
      finalizeEvent(
        {
          ...buildComment({
            root: ROOT,
            parent: { id: parent.id, pubkey: parent.pubkey },
            content: "the reply",
          }),
          created_at: 20,
        },
        authorKey,
      ),
    );
    main.eose();
    await settleTimers();
    references[0]?.eose();
    await settleTimers();

    expect(discussionState().count).toBe(2);
    expect(discussionState().roots).toHaveLength(1);
    expect(discussionState().roots[0]?.replies).toHaveLength(1);
  });
});
