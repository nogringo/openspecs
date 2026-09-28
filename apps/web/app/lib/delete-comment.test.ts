import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setDeleting: vi.fn(),
  addToDiscussion: vi.fn(),
  signDraft: vi.fn(),
  commentRebroadcastRelays: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("./discussion", () => ({
  setDeleting: mocks.setDeleting,
  addToDiscussion: mocks.addToDiscussion,
}));
vi.mock("./publish", () => ({ signDraft: mocks.signDraft }));
vi.mock("./outbox", () => ({ enqueue: mocks.enqueue }));
vi.mock("./relays", async (original) => ({
  ...(await original<typeof import("./relays")>()),
  commentRebroadcastRelays: mocks.commentRebroadcastRelays,
}));

import { COMMENT_KIND, DELETION_KIND, type NostrEvent } from "@openspecs/nostr";
import { deleteComment } from "./delete-comment";
import { FALLBACK_RELAYS } from "./relays";

const me = "1".repeat(64);

const COMMENT: NostrEvent = {
  id: "c".repeat(64),
  pubkey: me,
  created_at: 1,
  kind: COMMENT_KIND,
  tags: [["P", "3".repeat(64)]],
  content: "a comment",
  sig: "f".repeat(128),
};

const DELETION: NostrEvent = {
  id: "d".repeat(64),
  pubkey: me,
  created_at: 2,
  kind: DELETION_KIND,
  tags: [["e", COMMENT.id]],
  content: "",
  sig: "f".repeat(128),
};

const RELAYS = ["wss://relay.example"];

beforeEach(() => {
  vi.stubGlobal("window", {});
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.signDraft.mockResolvedValue(DELETION);
  mocks.commentRebroadcastRelays.mockResolvedValue(RELAYS);
});

afterEach(() => vi.unstubAllGlobals());

describe("deleteComment", () => {
  it("takes the comment off the screen before the signer answers", async () => {
    let answer: (event: NostrEvent) => void = () => {};
    mocks.signDraft.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const done = deleteComment(COMMENT);
    expect(mocks.setDeleting).toHaveBeenCalledWith(COMMENT.id, true);
    expect(mocks.addToDiscussion).not.toHaveBeenCalled();

    answer(DELETION);
    await done;
    expect(mocks.addToDiscussion).toHaveBeenCalledWith(DELETION);
  });

  it("signs a deletion naming the comment, and owes it to where the comment went", async () => {
    await deleteComment(COMMENT);

    const [draft] = mocks.signDraft.mock.calls[0] ?? [];
    expect(draft.kind).toBe(DELETION_KIND);
    expect(draft.tags).toContainEqual(["e", COMMENT.id]);
    expect(mocks.commentRebroadcastRelays).toHaveBeenCalledWith(COMMENT);
    expect(mocks.enqueue).toHaveBeenCalledWith(DELETION, RELAYS);
  });

  it("puts the comment back when the signer refuses", async () => {
    mocks.signDraft.mockRejectedValue(new Error("refused"));
    await deleteComment(COMMENT);

    expect(mocks.setDeleting).toHaveBeenLastCalledWith(COMMENT.id, false);
    expect(mocks.addToDiscussion).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("still sends it somewhere when no relay list could be read", async () => {
    mocks.commentRebroadcastRelays.mockRejectedValue(new Error("offline"));
    await deleteComment(COMMENT);

    expect(mocks.enqueue).toHaveBeenCalledWith(DELETION, FALLBACK_RELAYS);
  });
});
