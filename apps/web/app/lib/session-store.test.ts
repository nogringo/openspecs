import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredSession,
  parsePendingConnect,
  parseStoredSession,
  readSession,
  type StoredSession,
  writeSession,
} from "./session-store";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

const EXTENSION: StoredSession = { v: 1, method: "extension", pubkey: KEY };

const REMOTE: StoredSession = {
  v: 1,
  method: "remote",
  pubkey: KEY,
  bunker: { pubkey: OTHER, relays: ["wss://relay.nsec.app"] },
  clientSecret: "c".repeat(64),
};

const LOCAL: StoredSession = {
  v: 1,
  method: "key",
  pubkey: KEY,
  ncryptsec: "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd",
};

/** A fake with the one behaviour that matters: it can be written to and read back. */
const fakeStorage = (broken = false): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.set(key, value);
    },
    removeItem: (key: string) => void held.delete(key),
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("parseStoredSession", () => {
  it("reads back each of the three methods", () => {
    for (const record of [EXTENSION, REMOTE, LOCAL]) {
      expect(parseStoredSession(record)).toEqual(record);
    }
  });

  it("refuses a record written by a version that is not this one", () => {
    expect(parseStoredSession({ ...EXTENSION, v: 2 })).toBeNull();
    expect(parseStoredSession({ ...EXTENSION, v: undefined })).toBeNull();
  });

  it("refuses a key that is not one", () => {
    expect(parseStoredSession({ ...EXTENSION, pubkey: "a".repeat(63) })).toBeNull();
    expect(parseStoredSession({ ...EXTENSION, pubkey: "npub1abc" })).toBeNull();
    expect(parseStoredSession({ ...EXTENSION, pubkey: 7 })).toBeNull();
  });

  it("refuses junk of every shape", () => {
    for (const junk of [null, undefined, "", "[]", 7, [], {}]) {
      expect(parseStoredSession(junk)).toBeNull();
    }
  });

  it("refuses a method it has never heard of", () => {
    expect(parseStoredSession({ v: 1, method: "telepathy", pubkey: KEY })).toBeNull();
  });

  describe("a key on this device", () => {
    it("reads one kept under a passphrase", () => {
      expect(parseStoredSession(LOCAL)).toEqual(LOCAL);
    });

    /** A passphrase is offered and not imposed, so the key itself is a shape too. */
    it("reads one kept without a passphrase", () => {
      const plain = { v: 1, method: "key", pubkey: KEY, secret: "d".repeat(64) };
      expect(parseStoredSession(plain)).toEqual(plain);
    });

    it("prefers the encrypted form when a record somehow holds both", () => {
      const both = { ...LOCAL, secret: "d".repeat(64) };
      expect(parseStoredSession(both)).toEqual(LOCAL);
    });

    it("refuses one holding neither", () => {
      expect(parseStoredSession({ v: 1, method: "key", pubkey: KEY })).toBeNull();
      expect(parseStoredSession({ ...LOCAL, ncryptsec: "nsec1abc" })).toBeNull();
      expect(parseStoredSession({ v: 1, method: "key", pubkey: KEY, secret: "short" })).toBeNull();
    });
  });

  describe("a remote signer", () => {
    it("refuses a pointer missing any of its three parts", () => {
      expect(parseStoredSession({ ...REMOTE, bunker: undefined })).toBeNull();
      expect(parseStoredSession({ ...REMOTE, clientSecret: undefined })).toBeNull();
      expect(
        parseStoredSession({ ...REMOTE, bunker: { pubkey: OTHER, relays: undefined } }),
      ).toBeNull();
    });

    it("refuses a relay list holding something that is not a relay", () => {
      expect(
        parseStoredSession({ ...REMOTE, bunker: { pubkey: OTHER, relays: ["wss://a", 7] } }),
      ).toBeNull();
    });

    it("takes a signer that named no relay, since a URI may carry none", () => {
      const none = { ...REMOTE, bunker: { pubkey: OTHER, relays: [] } };
      expect(parseStoredSession(none)).toEqual(none);
    });
  });
});

describe("parsePendingConnect", () => {
  const PENDING = {
    v: 1 as const,
    uri: "nostrconnect://abc?relay=wss%3A%2F%2Frelay.nsec.app",
    clientSecret: "c".repeat(64),
    relays: ["wss://relay.nsec.app"],
  };

  it("reads back a handshake nobody has scanned yet", () => {
    expect(parsePendingConnect(PENDING)).toEqual(PENDING);
  });

  it("refuses anything that is not a nostrconnect address", () => {
    expect(parsePendingConnect({ ...PENDING, uri: "bunker://abc" })).toBeNull();
    expect(parsePendingConnect({ ...PENDING, uri: "" })).toBeNull();
  });

  it("refuses a client key that is not one", () => {
    expect(parsePendingConnect({ ...PENDING, clientSecret: "short" })).toBeNull();
  });
});

describe("the storage it is kept in", () => {
  it("writes what it can read back", () => {
    writeSession(REMOTE);
    expect(readSession()).toEqual(REMOTE);
  });

  it("refuses to write a record it could not read", () => {
    writeSession({ ...REMOTE, pubkey: "nonsense" } as StoredSession);
    expect(readSession()).toBeNull();
  });

  it("forgets one on request", () => {
    writeSession(EXTENSION);
    clearStoredSession();
    expect(readSession()).toBeNull();
  });

  it("reads nothing rather than throwing when the stored text is not JSON", () => {
    localStorage.setItem("openspecs:session", "{oops");
    expect(readSession()).toBeNull();
  });

  /** Safari in a private window has a localStorage whose setItem throws. */
  it("survives a browser that refuses to store anything", () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    expect(() => writeSession(EXTENSION)).not.toThrow();
    expect(readSession()).toBeNull();
  });

  it("survives a runtime with no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => writeSession(EXTENSION)).not.toThrow();
    expect(readSession()).toBeNull();
  });
});
