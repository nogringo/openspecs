import { describe, expect, it } from "vitest";
import { connectPath, returnTo } from "./paths";

describe("connectPath", () => {
  it("is the bare address when nothing sent anybody there", () => {
    expect(connectPath()).toBe("/connect");
    expect(connectPath("")).toBe("/connect");
  });

  it("carries where the reader was, query and all", () => {
    expect(connectPath("/specs?topic=nostr&page=2")).toBe(
      "/connect?next=%2Fspecs%3Ftopic%3Dnostr%26page%3D2",
    );
  });
});

describe("returnTo", () => {
  it("keeps a path on this site", () => {
    expect(returnTo("/spec/npub1abc/nip-07")).toBe("/spec/npub1abc/nip-07");
    expect(returnTo("/specs?topic=nostr")).toBe("/specs?topic=nostr");
  });

  it("falls back home when nothing said where to go", () => {
    expect(returnTo(null)).toBe("/");
    expect(returnTo("")).toBe("/");
  });

  it("never sends anybody back to the door itself", () => {
    expect(returnTo("/connect")).toBe("/");
    expect(returnTo("/connect?next=%2Fabout")).toBe("/");
  });

  it("refuses another origin, however it is spelled", () => {
    expect(returnTo("https://example.com/phish")).toBe("/");
    expect(returnTo("//example.com/phish")).toBe("/");
    expect(returnTo("/\\example.com/phish")).toBe("/");
    expect(returnTo("javascript:alert(1)")).toBe("/");
  });
});
