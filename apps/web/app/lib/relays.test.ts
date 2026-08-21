import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({
  fetchRelayLists: vi.fn(),
  writeRelaysOf: vi.fn(),
  DEFAULT_RELAYS: ["wss://relay.nmail.li", "wss://nos.lol"],
  DISCUSSION_RELAYS: ["wss://relay.ditto.pub", "wss://nos.lol"],
  relaySet: (...lists: string[][]) => {
    const urls = new Set<string>();
    for (const url of lists.flat()) if (/^wss?:\/\//.test(url)) urls.add(url);
    return [...urls];
  },
}));

vi.mock("@openspecs/nostr", () => nostr);

import { MAX_ZAP_RELAYS, writeRelays, zapReceiptRelays } from "./relays";

const ME = "a".repeat(64);
const AUTHOR = "b".repeat(64);
const PARENT = "c".repeat(64);

const lists = (entries: Record<string, { read: string[]; write: string[] }>) =>
  new Map(Object.entries(entries));

beforeEach(() => {
  nostr.fetchRelayLists.mockReset();
  nostr.writeRelaysOf.mockReset();
  nostr.writeRelaysOf.mockResolvedValue(["wss://mine.example"]);
  nostr.fetchRelayLists.mockResolvedValue(
    lists({ [AUTHOR]: { read: ["wss://their-inbox.example"], write: [] } }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("writeRelays", () => {
  it("puts my own relays first, then the inboxes of everyone addressed", async () => {
    const relays = await writeRelays(ME, { addressed: [AUTHOR] });

    expect(relays[0]).toBe("wss://mine.example");
    expect(relays[1]).toBe("wss://their-inbox.example");
  });

  it("reaches everyone the event is addressed to, not only the document's author", async () => {
    nostr.fetchRelayLists.mockResolvedValue(
      lists({
        [AUTHOR]: { read: ["wss://author-inbox.example"], write: [] },
        [PARENT]: { read: ["wss://parent-inbox.example"], write: [] },
      }),
    );

    const relays = await writeRelays(ME, { addressed: [AUTHOR, PARENT] });
    expect(relays).toContain("wss://author-inbox.example");
    expect(relays).toContain("wss://parent-inbox.example");
  });

  /**
   * Not redundancy: this site reads from these, and so does nostrhub. A comment
   * that reached only an inbox is a comment no page ever shows.
   */
  it("always includes the relays this kind of client reads", async () => {
    const relays = await writeRelays(ME, { addressed: [AUTHOR] });
    for (const relay of [...nostr.DISCUSSION_RELAYS, ...nostr.DEFAULT_RELAYS]) {
      expect(relays).toContain(relay);
    }
  });

  it("names a relay once however many lists it appears in", async () => {
    nostr.writeRelaysOf.mockResolvedValue(["wss://nos.lol"]);
    const relays = await writeRelays(ME, { addressed: [AUTHOR] });
    expect(relays.filter((relay) => relay === "wss://nos.lol")).toHaveLength(1);
  });

  it("takes two hints from what is being answered and no more", async () => {
    const relays = await writeRelays(ME, {
      addressed: [AUTHOR],
      hints: ["wss://hint-1.example", "wss://hint-2.example", "wss://hint-3.example"],
    });

    expect(relays).toContain("wss://hint-1.example");
    expect(relays).toContain("wss://hint-2.example");
    expect(relays).not.toContain("wss://hint-3.example");
  });

  it("takes an inbox the loader already resolved rather than asking again", async () => {
    const relays = await writeRelays(ME, {
      addressed: [AUTHOR],
      inbox: ["wss://from-the-loader.example"],
    });

    expect(relays).toContain("wss://from-the-loader.example");
    expect(nostr.fetchRelayLists).not.toHaveBeenCalled();
  });

  it("publishes somewhere for an author who published no list of their own", async () => {
    nostr.writeRelaysOf.mockResolvedValue([]);
    const relays = await writeRelays(ME, { addressed: [AUTHOR] });
    expect(relays).toEqual(expect.arrayContaining(nostr.DEFAULT_RELAYS));
  });

  /**
   * `PUBLIC_RELAYS` belongs to rebroadcasting a signed document, where no key is
   * involved. A first reply from an unknown key sprayed across seven large
   * relays collects refusals and looks broken.
   */
  it("never reaches for the relays rebroadcasting uses", async () => {
    const relays = await writeRelays(ME, { addressed: [AUTHOR] });
    for (const relay of ["wss://relay.snort.social", "wss://offchain.pub", "wss://nostr.mom"]) {
      expect(relays).not.toContain(relay);
    }
  });
});

describe("zapReceiptRelays", () => {
  it("puts the recipient first, since the receipt is theirs to see", async () => {
    nostr.fetchRelayLists.mockResolvedValue(
      lists({ [AUTHOR]: { read: ["wss://their-inbox.example"], write: [] } }),
    );

    const relays = await zapReceiptRelays(ME, AUTHOR);
    expect(relays[0]).toBe("wss://their-inbox.example");
  });

  it("stays short, because the whole request travels in a query parameter", async () => {
    nostr.writeRelaysOf.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => `wss://mine-${index}.example`),
    );

    expect((await zapReceiptRelays(ME, AUTHOR)).length).toBeLessThanOrEqual(MAX_ZAP_RELAYS);
  });
});
