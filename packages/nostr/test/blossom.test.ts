import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  BLOSSOM_AUTH_KIND,
  BLOSSOM_SERVER_KIND,
  blobHash,
  blobUrls,
  buildServerList,
  buildUploadAuth,
  MAX_RECOVERY_TRIES,
  parseServerList,
  selectServerLists,
  serverOrigin,
  serverSet,
  sha256Hex,
} from "../src/blossom";

const secretKey = generateSecretKey();
const author = getPublicKey(secretKey);

const serverListEvent = (tags: string[][], createdAt = 1_700_000_000) =>
  finalizeEvent({ kind: BLOSSOM_SERVER_KIND, created_at: createdAt, tags, content: "" }, secretKey);

describe("serverOrigin", () => {
  it("takes a host on its own, like the relay box does", () => {
    expect(serverOrigin("blossom.example.com")).toBe("https://blossom.example.com");
  });

  it("keeps a port and drops everything past the host", () => {
    expect(serverOrigin("https://blossom.example.com:8080/upload")).toBe(
      "https://blossom.example.com:8080",
    );
  });

  /** A picture served over http is blocked as mixed content by every page that draws it. */
  it("refuses a server that could only serve pictures nothing will show", () => {
    expect(serverOrigin("http://blossom.example.com")).toBeNull();
    expect(serverOrigin("")).toBeNull();
    expect(serverOrigin("not a server")).toBeNull();
  });
});

describe("serverSet", () => {
  it("names a server once, however it was spelled, keeping the first place", () => {
    expect(
      serverSet(["https://a.example/", "a.example"], ["https://b.example", "https://a.example"]),
    ).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("buildUploadAuth", () => {
  it("carries the verb, the hash and an expiry, which is what BUD-11 asks for", () => {
    const auth = buildUploadAuth("a".repeat(64), 1_700_000_300);

    expect(auth.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(auth.tags).toEqual([
      ["t", "upload"],
      ["x", "a".repeat(64)],
      ["expiration", "1700000300"],
    ]);
  });

  /** No `server` tag, so one signature covers every server tried in turn. */
  it("is not tied to a server", () => {
    expect(buildUploadAuth("a".repeat(64), 1).tags.some((tag) => tag[0] === "server")).toBe(false);
  });

  it("says what it is for, since somebody is asked to approve it", () => {
    expect(buildUploadAuth("a".repeat(64), 1).content).not.toBe("");
  });
});

describe("authorizationHeader", () => {
  it("is the signed event, base64url without padding, under the Nostr scheme", () => {
    const auth = finalizeEvent(
      { ...buildUploadAuth("a".repeat(64), 1_700_000_300), created_at: 1_700_000_000 },
      secretKey,
    );
    const header = authorizationHeader(auth);

    expect(header.startsWith("Nostr ")).toBe(true);
    const encoded = header.slice("Nostr ".length);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");

    const decoded = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    expect(decoded.pubkey).toBe(author);
    expect(decoded.sig).toBe(auth.sig);
  });
});

describe("sha256Hex", () => {
  it("hashes to the digest the server checks the body against", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("blobHash", () => {
  const HASH = "c440500c3f1194b5f3a12e7419b0d542f7a21b10ddd746b69680af4b8e9a6cf1";

  it("reads the hash a picture is addressed by, extension or not", () => {
    expect(blobHash(`https://a.example/${HASH}.png`)).toBe(HASH);
    expect(blobHash(`https://a.example/${HASH}`)).toBe(HASH);
    expect(blobHash(`https://a.example/${HASH.toUpperCase()}.PNG`)).toBe(HASH);
  });

  /** Most pictures in profiles in the wild, and nothing about them to recover. */
  it("is null for an address that names a place and not a thing", () => {
    expect(blobHash("https://example.com/photos/me.jpg")).toBeNull();
    expect(blobHash(`https://a.example/album/${HASH}.png`)).toBeNull();
    expect(blobHash("https://a.example/abc.png")).toBeNull();
    expect(blobHash("not a url")).toBeNull();
  });
});

describe("blobUrls", () => {
  const HASH = "c440500c3f1194b5f3a12e7419b0d542f7a21b10ddd746b69680af4b8e9a6cf1";
  const gone = `https://gone.example/${HASH}.png`;

  it("asks the other servers for the same blob, keeping the extension", () => {
    expect(blobUrls(gone, ["https://a.example", "https://b.example"])).toEqual([
      `https://a.example/${HASH}.png`,
      `https://b.example/${HASH}.png`,
    ]);
  });

  it("leaves out the server that just failed, however it was spelled", () => {
    expect(blobUrls(gone, ["gone.example/", "https://a.example"])).toEqual([
      `https://a.example/${HASH}.png`,
    ]);
  });

  /** Every try is a request that has to fail before the next one is made. */
  it("stops trying rather than working through a dozen servers in a row", () => {
    const many = Array.from({ length: 9 }, (_, i) => `https://s${i}.example`);
    expect(blobUrls(gone, many)).toHaveLength(MAX_RECOVERY_TRIES);
  });

  it("has nowhere to look for a picture that is not addressed by its hash", () => {
    expect(blobUrls("https://example.com/me.jpg", ["https://a.example"])).toEqual([]);
    expect(blobUrls("not a url", ["https://a.example"])).toEqual([]);
  });
});

describe("selectServerLists", () => {
  it("keeps the revision the author published last", () => {
    const stale = serverListEvent([["server", "https://old.example"]], 1_700_000_000);
    const live = serverListEvent([["server", "https://new.example"]], 1_700_000_100);

    expect(selectServerLists([live, stale]).get(author)).toEqual(["https://new.example"]);
    expect(selectServerLists([stale, live]).get(author)).toEqual(["https://new.example"]);
  });

  it("ignores anything that is not a server list", () => {
    expect(selectServerLists([null, {}, BLOSSOM_SERVER_KIND]).size).toBe(0);
  });
});

describe("buildServerList", () => {
  const SERVERS = ["https://a.example", "https://b.example", "https://c.example"];

  it("reads back as the servers it was given, in the order it was given them", () => {
    expect(parseServerList({ ...serverListEvent([]), ...buildServerList(SERVERS) })).toEqual(
      SERVERS,
    );
  });

  it("takes a host on its own and names a server once", () => {
    const built = buildServerList(["a.example", "https://a.example/", "https://b.example"]);
    expect(parseServerList({ ...serverListEvent([]), ...built })).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  /**
   * A save that dropped the fifth would delete a server its author had just
   * added, and this list is read by clients that do not share this one's bounds.
   */
  it("names every server it was given, however many that is", () => {
    const many = Array.from({ length: 9 }, (_, i) => `https://s${i}.example`);
    expect(buildServerList(many).tags.filter((tag) => tag[0] === "server")).toHaveLength(9);
    expect(parseServerList({ ...serverListEvent([]), ...buildServerList(many) })).toHaveLength(9);
  });

  it("names the client, like every other event this package builds", () => {
    expect(buildServerList(SERVERS).tags.at(-1)).toEqual(["client", "Open Specs"]);
  });
});

describe("parseServerList", () => {
  it("keeps the order the author put their servers in, most trusted first", () => {
    const list = serverListEvent([
      ["server", "https://mine.example"],
      ["server", "https://theirs.example"],
    ]);
    expect(parseServerList(list)).toEqual(["https://mine.example", "https://theirs.example"]);
  });

  it("ignores tags that are not servers, and servers that are not usable", () => {
    const list = serverListEvent([
      ["client", "Open Specs"],
      ["server", "http://insecure.example"],
      ["server"],
      ["server", "https://good.example"],
    ]);
    expect(parseServerList(list)).toEqual(["https://good.example"]);
  });

  /** An author reading their own list back to edit it must see all of it. */
  it("keeps every server, and leaves the bounding to whoever opens connections", () => {
    const tags = Array.from({ length: 9 }, (_, i) => ["server", `https://s${i}.example`]);
    expect(parseServerList(serverListEvent(tags))).toHaveLength(9);
  });

  it("rejects another kind", () => {
    expect(parseServerList({ ...serverListEvent([]), kind: 10002 })).toBeNull();
    expect(parseServerList(null)).toBeNull();
  });
});
