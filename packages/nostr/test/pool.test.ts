import { describe, expect, it } from "vitest";
import { relaySet, relayUrl } from "../src/pool";

describe("relaySet", () => {
  it("names a relay once, however it was spelled", () => {
    expect(relaySet(["wss://a.example", "wss://a.example/", "WSS://A.example"])).toEqual([
      "wss://a.example/",
    ]);
  });

  it("keeps the first place a relay was named, which is what the order is for", () => {
    expect(
      relaySet(["wss://mine.example"], ["wss://theirs.example", "wss://mine.example"]),
    ).toEqual(["wss://mine.example/", "wss://theirs.example/"]);
  });

  it("drops what is not a relay rather than opening a socket to it", () => {
    expect(relaySet(["https://a.example", "a.example", "", "javascript:alert(1)"])).toEqual([]);
  });
});

describe("relayUrl", () => {
  it("takes a host on its own, since the scheme is the part nobody remembers", () => {
    expect(relayUrl("relay.example.com")).toBe("wss://relay.example.com/");
    expect(relayUrl("  relay.example.com  ")).toBe("wss://relay.example.com/");
  });

  it("takes what a browser bar hands back when a relay's own page is copied", () => {
    expect(relayUrl("https://relay.example.com")).toBe("wss://relay.example.com/");
    expect(relayUrl("http://relay.example.com")).toBe("wss://relay.example.com/");
  });

  it("leaves a relay that was typed properly alone", () => {
    expect(relayUrl("wss://relay.example.com")).toBe("wss://relay.example.com/");
    expect(relayUrl("ws://localhost:7777")).toBe("ws://localhost:7777/");
  });

  it("keeps a port and a path, which some relays are only reachable at", () => {
    expect(relayUrl("relay.example.com:7777/nostr")).toBe("wss://relay.example.com:7777/nostr");
  });

  it("refuses what cannot be a relay at all", () => {
    expect(relayUrl("")).toBeNull();
    expect(relayUrl("   ")).toBeNull();
    expect(relayUrl("not a relay")).toBeNull();
  });
});
