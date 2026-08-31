import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({
  fetchRelayLists: vi.fn(),
  writeRelaysOf: vi.fn(),
  authorRelays: vi.fn(),
  DEFAULT_RELAYS: ["wss://relay.nmail.li", "wss://nos.lol"],
  IMPORT_RELAYS: ["wss://relay.openspecs.example"],
  DISCUSSION_RELAYS: ["wss://relay.ditto.pub", "wss://nos.lol"],
  INDEXER_RELAYS: ["wss://indexer.example", "wss://nos.lol"],
  MAX_RELAYS_PER_AUTHOR: 4,
  relaySet: (...lists: string[][]) => {
    const urls = new Set<string>();
    for (const url of lists.flat()) if (/^wss?:\/\//.test(url)) urls.add(url);
    return [...urls];
  },
}));

vi.mock("@openspecs/nostr", () => nostr);

import {
  announceRelays,
  documentRelays,
  identityRelays,
  MAX_WRITE_RELAYS,
  MAX_ZAP_RELAYS,
  muteListRelays,
  newKeyRelays,
  PUBLIC_RELAYS,
  relayListRelays,
  reportRelays,
  writeRelays,
  zapReceiptRelays,
} from "./relays";

const ME = "a".repeat(64);
const AUTHOR = "b".repeat(64);
const PARENT = "c".repeat(64);

const lists = (entries: Record<string, { read: string[]; write: string[] }>) =>
  new Map(Object.entries(entries));

beforeEach(() => {
  nostr.fetchRelayLists.mockReset();
  nostr.writeRelaysOf.mockReset();
  nostr.authorRelays.mockReset();
  nostr.authorRelays.mockResolvedValue(["wss://theirs.example"]);
  nostr.writeRelaysOf.mockResolvedValue(["wss://mine.example"]);
  nostr.fetchRelayLists.mockResolvedValue(
    lists({ [AUTHOR]: { read: ["wss://their-inbox.example"], write: [] } }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("muteListRelays", () => {
  it("is my own write relays and then the ones this site reads", async () => {
    expect(await muteListRelays(ME)).toEqual(["wss://mine.example", ...nostr.DEFAULT_RELAYS]);
  });

  it("falls back to the relays this site reads for a key with no list", async () => {
    nostr.writeRelaysOf.mockResolvedValue([]);
    expect(await muteListRelays(ME)).toEqual(nostr.DEFAULT_RELAYS);
  });
});

describe("reportRelays", () => {
  it("starts with mine and the reported key's own, then reaches everywhere else", async () => {
    const relays = await reportRelays(ME, AUTHOR);

    expect(relays.slice(0, 2)).toEqual(["wss://mine.example", "wss://theirs.example"]);
    for (const relay of [
      ...nostr.DISCUSSION_RELAYS,
      ...nostr.DEFAULT_RELAYS,
      ...nostr.IMPORT_RELAYS,
      ...nostr.INDEXER_RELAYS,
      ...PUBLIC_RELAYS,
    ]) {
      expect(relays).toContain(relay);
    }
    expect(nostr.authorRelays).toHaveBeenCalledWith(AUTHOR);
  });

  it("has no relays of mine for a report from a key made on the spot", async () => {
    const relays = await reportRelays(null, AUTHOR);

    expect(relays[0]).toBe("wss://theirs.example");
    expect(relays).not.toContain("wss://mine.example");
    expect(nostr.writeRelaysOf).not.toHaveBeenCalled();
    expect(relays).toContain(nostr.IMPORT_RELAYS[0]);
  });

  it("is the one write that is never cut short", async () => {
    nostr.writeRelaysOf.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => `wss://mine-${index}.example`),
    );
    nostr.authorRelays.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => `wss://theirs-${index}.example`),
    );

    const relays = await reportRelays(ME, AUTHOR);
    expect(relays.length).toBeGreaterThan(MAX_WRITE_RELAYS);
    expect(relays).toContain(PUBLIC_RELAYS[PUBLIC_RELAYS.length - 1]);
  });

  it("goes out without the reported key's list when that lookup fails", async () => {
    nostr.authorRelays.mockRejectedValue(new Error("gone"));

    const relays = await reportRelays(ME, AUTHOR);
    expect(relays[0]).toBe("wss://mine.example");
    expect(relays).toContain(PUBLIC_RELAYS[0]);
  });
});

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

describe("announceRelays", () => {
  it("puts the indexers first, because a profile is read from there and nowhere else", () => {
    expect(announceRelays()[0]).toBe("wss://indexer.example");
  });

  it("names the relays this site reads too, and names none of them twice", () => {
    const relays = announceRelays();
    expect(relays).toContain("wss://relay.nmail.li");
    expect(new Set(relays).size).toBe(relays.length);
  });

  /**
   * The whole point of the helper. A key made a second ago has no list to find,
   * and asking for one would cache its absence over the list being published.
   */
  it("asks nobody where a brand new key publishes", () => {
    announceRelays();
    expect(nostr.writeRelaysOf).not.toHaveBeenCalled();
    expect(nostr.fetchRelayLists).not.toHaveBeenCalled();
  });
});

describe("newKeyRelays", () => {
  it("names no more relays than a reader keeps", () => {
    expect(newKeyRelays().length).toBeLessThanOrEqual(4);
  });
});

describe("documentRelays", () => {
  it("puts the author's own relays first, since that is where their readers look", async () => {
    expect((await documentRelays(ME))[0]).toBe("wss://mine.example");
  });

  /**
   * The case the whole function exists for: a key with a relay list of its own
   * would otherwise publish somewhere this site's loader never reads, and no
   * mirror would ever find the document to copy it.
   */
  it("always reaches the relays this site and the crawler read", async () => {
    const relays = await documentRelays(ME);
    expect(relays).toEqual(expect.arrayContaining(nostr.DEFAULT_RELAYS));
  });

  it("still has somewhere to publish for a key that named no relays", async () => {
    nostr.writeRelaysOf.mockResolvedValue([]);
    expect(await documentRelays(ME)).toEqual(expect.arrayContaining(nostr.DEFAULT_RELAYS));
  });

  it("names a relay once however many lists it appears in", async () => {
    nostr.writeRelaysOf.mockResolvedValue(["wss://nos.lol"]);
    const relays = await documentRelays(ME);
    expect(relays.filter((relay) => relay === "wss://nos.lol")).toHaveLength(1);
  });

  it("does not spray a young key across the relays a rebroadcast is for", async () => {
    expect(await documentRelays(ME)).not.toContain("wss://relay.ditto.pub");
  });

  it("stays under the backstop however malformed the list it was handed", async () => {
    nostr.writeRelaysOf.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => `wss://relay-${index}.example`),
    );
    expect((await documentRelays(ME)).length).toBeLessThanOrEqual(MAX_WRITE_RELAYS);
  });
});

describe("identityRelays", () => {
  it("puts the indexers first, because a profile is read from there and nowhere else", async () => {
    expect((await identityRelays(ME))[0]).toBe("wss://indexer.example");
  });

  it("reaches where this site reads, so a profile published minutes ago is found", async () => {
    const relays = await identityRelays(ME);
    expect(relays).toEqual(expect.arrayContaining(nostr.DEFAULT_RELAYS));
  });

  it("reaches a relay only this key publishes to", async () => {
    expect(await identityRelays(ME)).toContain("wss://mine.example");
  });

  it("names a relay once however many lists it appears in", async () => {
    nostr.writeRelaysOf.mockResolvedValue(["wss://nos.lol"]);
    const relays = await identityRelays(ME);
    expect(relays.filter((relay) => relay === "wss://nos.lol")).toHaveLength(1);
  });
});

describe("relayListRelays", () => {
  it("tells the relays a key has just named that it names them", async () => {
    expect(await relayListRelays(ME, ["wss://chosen.example"])).toContain("wss://chosen.example");
  });

  /**
   * The relays being replaced have to hear it too, or a client reading the old
   * list from the old relay keeps sending this key's readers to the wrong place.
   */
  it("still reaches the relays the list is moving away from", async () => {
    expect(await relayListRelays(ME, ["wss://chosen.example"])).toContain("wss://mine.example");
  });

  it("stays within one page's worth of sockets, however long a list is typed", async () => {
    const many = Array.from({ length: 60 }, (_, index) => `wss://chosen-${index}.example`);
    expect((await relayListRelays(ME, many)).length).toBe(MAX_WRITE_RELAYS);
  });
});
