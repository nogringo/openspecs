import { verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { parseRelayList, RELAY_LIST_KIND, selectRelayLists } from "../src/nip65";
import { events, relayListEvents } from "./fixtures";

const anEvent = relayListEvents[0];
if (!anEvent) throw new Error("no relay list fixture");

describe("relay list fixtures", () => {
  it("are verbatim events, signatures intact", () => {
    const forged = relayListEvents.filter((event) => !verifyEvent(event));
    expect(forged.map((e) => e.id)).toEqual([]);
  });

  it("belong to authors that published a specification", () => {
    const authors = new Set(events.map((event) => event.pubkey));
    for (const event of relayListEvents) expect(authors.has(event.pubkey)).toBe(true);
  });
});

describe("parseRelayList", () => {
  it("reads every fixture", () => {
    for (const event of relayListEvents) {
      const list = parseRelayList(event);
      expect(list, `fixture ${event.id} should parse`).not.toBeNull();
      for (const url of [...(list?.write ?? []), ...(list?.read ?? [])]) {
        expect(url).toMatch(/^wss?:\/\//);
      }
    }
  });

  it("gives at least one author somewhere to write", () => {
    const writable = relayListEvents.filter(
      (event) => (parseRelayList(event)?.write.length ?? 0) > 0,
    );
    expect(writable.length).toBeGreaterThan(0);
  });

  it("treats an unmarked relay as both read and write, as the NIP says", () => {
    const list = parseRelayList({ ...anEvent, tags: [["r", "wss://relay.example.com"]] });
    expect(list?.write).toEqual(["wss://relay.example.com/"]);
    expect(list?.read).toEqual(["wss://relay.example.com/"]);
  });

  it("honours read and write markers", () => {
    const list = parseRelayList({
      ...anEvent,
      tags: [
        ["r", "wss://out.example.com", "write"],
        ["r", "wss://in.example.com", "read"],
      ],
    });
    expect(list?.write).toEqual(["wss://out.example.com/"]);
    expect(list?.read).toEqual(["wss://in.example.com/"]);
  });

  it("ignores tags that are not relays", () => {
    const list = parseRelayList({
      ...anEvent,
      tags: [["client", "vidstr.example.com"], ["r", "https://not-a-relay.example.com"], ["r"]],
    });
    expect(list).toEqual({ write: [], read: [] });
  });

  it("caps a list that grew unusable", () => {
    const tags = Array.from({ length: 30 }, (_, i) => ["r", `wss://relay${i}.example.com`]);
    expect(parseRelayList({ ...anEvent, tags })?.write).toHaveLength(4);
  });

  it("rejects another kind", () => {
    expect(parseRelayList({ ...anEvent, kind: 10003 })).toBeNull();
    expect(parseRelayList(null)).toBeNull();
  });
});

describe("selectRelayLists", () => {
  it("keeps one list per author, the newest", () => {
    const lists = selectRelayLists(relayListEvents);
    const authors = new Set(relayListEvents.map((event) => event.pubkey));
    expect(lists.size).toBe(authors.size);

    for (const author of authors) {
      const revisions = relayListEvents.filter((event) => event.pubkey === author);
      const newest = revisions.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      expect(lists.get(author)).toEqual(parseRelayList(newest));
    }
  });

  it("has something to choose from: indexers really do serve stale revisions", () => {
    const perAuthor = new Map<string, number>();
    for (const event of relayListEvents) {
      perAuthor.set(event.pubkey, (perAuthor.get(event.pubkey) ?? 0) + 1);
    }
    expect([...perAuthor.values()].filter((count) => count > 1).length).toBeGreaterThan(0);
  });

  it("ignores anything that is not a relay list", () => {
    expect(selectRelayLists(events).size).toBe(0);
    expect(selectRelayLists([null, {}, RELAY_LIST_KIND]).size).toBe(0);
  });
});
