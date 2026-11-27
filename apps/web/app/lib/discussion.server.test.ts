import { afterEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({ fetchDiscussionEvents: vi.fn(), fetchProfiles: vi.fn() }));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  ...nostr,
}));

import { buildComment, type NostrEvent, SPEC_KIND, toNpub } from "@openspecs/nostr";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { loadDiscussion } from "./discussion.server";

const authorKey = generateSecretKey();
const readerKey = generateSecretKey();
const author = getPublicKey(authorKey);
const reader = getPublicKey(readerKey);
const named = getPublicKey(generateSecretKey());

const pageOf = (eventId: string) => ({ pubkey: author, identifier: "a-specification", eventId });
const ROOT = { coordinate: `${SPEC_KIND}:${author}:a-specification`, pubkey: author };

const comment = (content: string): NostrEvent =>
  finalizeEvent({ ...buildComment({ root: ROOT, content }), created_at: 10 }, readerKey);

const profileOf = (name: string) => ({
  name,
  picture: null,
  nip05: null,
  website: null,
  about: "",
  lud16: null,
  lud06: null,
});

afterEach(() => {
  nostr.fetchDiscussionEvents.mockReset();
  nostr.fetchProfiles.mockReset();
  vi.useRealTimers();
});

describe("loadDiscussion", () => {
  it("hands over the events with the names of who wrote and who is named", async () => {
    const said = comment(`thanks nostr:${toNpub(named)}`);
    nostr.fetchDiscussionEvents.mockResolvedValue([said]);
    nostr.fetchProfiles.mockImplementation(
      async (keys: string[]) => new Map(keys.map((key) => [key, profileOf(key.slice(0, 4))])),
    );

    const known = await loadDiscussion(pageOf("a".repeat(64)));

    expect(known?.coordinate).toBe(ROOT.coordinate);
    expect(known?.events).toEqual([said]);
    expect(Object.keys(known?.authors ?? {}).sort()).toEqual([reader, named].sort());
    expect(nostr.fetchDiscussionEvents).toHaveBeenCalledWith({
      coordinate: ROOT.coordinate,
      specEventId: "a".repeat(64),
    });
  });

  it("gives up on slow relays, and has the answer for the next request", async () => {
    vi.useFakeTimers();
    const answers: ((events: NostrEvent[]) => void)[] = [];
    nostr.fetchDiscussionEvents.mockImplementation(
      () =>
        new Promise<NostrEvent[]>((resolve) => {
          answers.push(resolve);
        }),
    );
    nostr.fetchProfiles.mockResolvedValue(new Map());

    const first = loadDiscussion(pageOf("b".repeat(64)));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toBeNull();

    for (const answer of answers) answer([comment("late")]);
    await vi.advanceTimersByTimeAsync(0);
    const next = await loadDiscussion(pageOf("b".repeat(64)));
    expect(next?.events).toHaveLength(1);
    expect(nostr.fetchDiscussionEvents).toHaveBeenCalledTimes(1);
  });

  it("serves the conversation without names rather than holding the page for them", async () => {
    vi.useFakeTimers();
    nostr.fetchDiscussionEvents.mockResolvedValue([comment("said")]);
    nostr.fetchProfiles.mockReturnValue(new Promise(() => {}));

    const known = loadDiscussion(pageOf("c".repeat(64)));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(known).resolves.toMatchObject({ authors: {} });
  });
});
