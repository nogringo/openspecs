import { naddrEncode, nprofileEncode, npubEncode } from "nostr-tools/nip19";
import { describe, expect, it } from "vitest";
import {
  authorPath,
  parseCoordinate,
  parsePubkey,
  parseSpecAddress,
  specPath,
  toCoordinate,
  toNaddr,
} from "../src/address";
import { SPEC_KIND } from "../src/event";
import { parseSpec } from "../src/spec";
import { caseEvents, events } from "./fixtures";

const specs = events.map(parseSpec).filter((spec) => spec !== null);

describe("coordinates", () => {
  it("round trips every fixture specification", () => {
    for (const spec of specs) {
      expect(parseSpecAddress(toCoordinate(spec))).toEqual({
        pubkey: spec.pubkey,
        identifier: spec.identifier,
        relays: [],
      });
    }
  });

  it("keeps an identifier that contains colons intact", () => {
    for (const event of caseEvents("d-not-kebab")) {
      const spec = parseSpec(event);
      if (!spec) throw new Error(`fixture ${event.id} should parse`);
      expect(parseCoordinate(toCoordinate(spec))?.identifier).toBe(spec.identifier);
    }
  });

  it("rejects a coordinate that does not address a specification", () => {
    const { pubkey, identifier } = specs[0] ?? { pubkey: "", identifier: "" };
    expect(parseCoordinate(`30023:${pubkey}:${identifier}`)).toBeNull();
    expect(parseCoordinate(`${SPEC_KIND}:not-a-key:${identifier}`)).toBeNull();
    expect(parseCoordinate(`${SPEC_KIND}:${pubkey}:`)).toBeNull();
    expect(parseCoordinate("")).toBeNull();
  });
});

describe("naddr", () => {
  it("round trips every fixture specification", () => {
    for (const spec of specs) {
      const decoded = parseSpecAddress(toNaddr(spec));
      expect(decoded?.pubkey).toBe(spec.pubkey);
      expect(decoded?.identifier).toBe(spec.identifier);
    }
  });

  it("carries relay hints through", () => {
    const spec = specs[0];
    if (!spec) throw new Error("no fixture specification");
    const hint = "wss://relay.example.com/";
    expect(parseSpecAddress(toNaddr({ ...spec, relays: [hint] }))?.relays).toEqual([hint]);
  });

  it("tolerates the nostr: prefix and uppercase", () => {
    const spec = specs[0];
    if (!spec) throw new Error("no fixture specification");
    const naddr = toNaddr(spec);
    expect(parseSpecAddress(`nostr:${naddr}`)?.identifier).toBe(spec.identifier);
    expect(parseSpecAddress(naddr.toUpperCase())?.identifier).toBe(spec.identifier);
  });

  it("rejects an naddr pointing at another kind", () => {
    const spec = specs[0];
    if (!spec) throw new Error("no fixture specification");
    const naddr = naddrEncode({ kind: 30023, pubkey: spec.pubkey, identifier: spec.identifier });
    expect(parseSpecAddress(naddr)).toBeNull();
  });

  it("rejects anything that is not an address", () => {
    const spec = specs[0];
    if (!spec) throw new Error("no fixture specification");
    expect(parseSpecAddress(npubEncode(spec.pubkey))).toBeNull();
    expect(parseSpecAddress("naddr1nope")).toBeNull();
    expect(parseSpecAddress("")).toBeNull();
  });
});

describe("parsePubkey", () => {
  it("accepts hex, npub and nprofile", () => {
    for (const spec of specs) {
      expect(parsePubkey(spec.pubkey)).toBe(spec.pubkey);
      expect(parsePubkey(npubEncode(spec.pubkey))).toBe(spec.pubkey);
      expect(parsePubkey(nprofileEncode({ pubkey: spec.pubkey }))).toBe(spec.pubkey);
    }
  });

  it("rejects a key that is not one", () => {
    expect(parsePubkey("alice@example.com")).toBeNull();
    expect(parsePubkey("npub1nope")).toBeNull();
    expect(parsePubkey("")).toBeNull();
  });
});

describe("specPath", () => {
  it("keeps the identifier in a single path segment", () => {
    for (const spec of specs) {
      const path = specPath(spec);
      expect(path.split("/")).toHaveLength(4);
      expect(decodeURIComponent(path.split("/")[3] ?? "")).toBe(spec.identifier);
    }
  });
});

describe("authorPath", () => {
  it("puts the npub at the root, and nothing else with it", () => {
    for (const spec of specs) {
      expect(authorPath(spec.pubkey)).toBe(`/${npubEncode(spec.pubkey)}`);
    }
  });

  it("names the author a document is signed by", () => {
    for (const spec of specs) {
      expect(specPath(spec).startsWith(`/spec${authorPath(spec.pubkey)}/`)).toBe(true);
    }
  });
});
