import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const extension = vi.hoisted(() => ({ extensionSigner: vi.fn() }));
const remote = vi.hoisted(() => ({
  reconnect: vi.fn(),
  connectToBunker: vi.fn(),
  parseBunker: vi.fn(),
  startConnect: vi.fn(),
  awaitConnect: vi.fn(),
  closeSignerPool: vi.fn(),
  CONNECT_RELAYS: ["wss://relay.nsec.app"],
}));

vi.mock("./signer-extension", () => extension);
vi.mock("./signer-remote", () => remote);

/**
 * The real cost takes about a second a call, and this file makes a dozen. Only
 * the cost is replaced: everything that reads a key back has to be the real
 * thing, or these tests pass against a mock. Decrypting needs no help, since a
 * NIP-49 key carries the cost it was written at.
 */
vi.mock("./signer-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./signer-key")>();
  return {
    ...actual,
    encryptSecretKey: (secret: Uint8Array, passphrase: string) =>
      actual.encryptSecretKey(secret, passphrase, 8),
  };
});

import {
  clearSession,
  logout,
  NO_SESSION,
  protectKey,
  restoreSession,
  serverSessionState,
  sessionNsec,
  sessionState,
  signer,
  signInWithExtension,
  signInWithNewKey,
  signInWithSecretKey,
  subscribeSession,
  unlock,
} from "./session";
import { clearStoredSession, type StoredSession, writeSession } from "./session-store";
import { SessionLocked, SessionMissing } from "./signer";
import { parseSecretKey, publicKeyOf } from "./signer-key";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

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

const fakeStorage = (): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

const aSigner = (pubkey = KEY) => ({
  getPublicKey: vi.fn().mockResolvedValue(pubkey),
  signEvent: vi.fn(),
});

/** The store only runs in a browser, and the suite is a Node one. */
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("sessionStorage", fakeStorage());
  clearSession();
  clearStoredSession();
  for (const mock of [...Object.values(extension), ...Object.values(remote)]) {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }
});

afterEach(() => vi.unstubAllGlobals());

describe("what the server renders", () => {
  /**
   * The hydration invariant, written as a unit test because this suite has no
   * server to render against: the first client render must agree with the HTML.
   */
  it("is signed out, whatever the store has since become", async () => {
    expect(serverSessionState()).toBe(NO_SESSION);

    writeSession(REMOTE);
    restoreSession();
    expect(sessionState().pubkey).toBe(KEY);
    expect(serverSessionState()).toBe(NO_SESSION);
  });

  it("is the same frozen value every time, so a snapshot never looks new", () => {
    expect(serverSessionState()).toBe(serverSessionState());
    expect(Object.isFrozen(NO_SESSION)).toBe(true);
  });
});

describe("restoreSession", () => {
  it("reads storage once, however often it is called", () => {
    writeSession(REMOTE);
    restoreSession();
    restoreSession();
    // A second read would have found the record again after this cleared it.
    clearStoredSession();
    restoreSession();
    expect(sessionState().pubkey).toBe(KEY);
  });

  it("leaves a remote signer locked rather than opening a socket to read a page", () => {
    writeSession(REMOTE);
    restoreSession();

    expect(sessionState()).toMatchObject({ pubkey: KEY, method: "remote", status: "locked" });
    expect(remote.reconnect).not.toHaveBeenCalled();
  });

  it("leaves a key on this device locked, and decrypts nothing", () => {
    writeSession(LOCAL);
    restoreSession();
    expect(sessionState()).toMatchObject({ method: "key", status: "locked" });
  });

  /** Nothing to unlock, so nothing is asked: that is what declining one bought. */
  it("opens a key kept without a passphrase without asking for one", async () => {
    writeSession({ v: 1, method: "key", pubkey: KEY, secret: "d".repeat(64) });
    restoreSession();

    await vi.waitFor(() => expect(sessionState().status).toBe("ready"));
    await expect(signer()).resolves.toBeDefined();
  });

  it("settles an extension at once, since asking costs nothing and prompts nobody", async () => {
    extension.extensionSigner.mockResolvedValue(aSigner());
    writeSession({ v: 1, method: "extension", pubkey: KEY });
    restoreSession();

    await vi.waitFor(() => expect(sessionState().status).toBe("ready"));
    expect(extension.extensionSigner).toHaveBeenCalled();
  });

  it("says so plainly when the extension it remembered is gone", async () => {
    extension.extensionSigner.mockRejectedValue(new Error("no signing extension answered"));
    writeSession({ v: 1, method: "extension", pubkey: KEY });
    restoreSession();

    await vi.waitFor(() => expect(sessionState().status).toBe("failed"));
    expect(sessionState().error).toBe("no signing extension answered");
    // The key is still known: what failed is reaching it, not who it belongs to.
    expect(sessionState().pubkey).toBe(KEY);
  });

  it("stays signed out when nothing was stored", () => {
    restoreSession();
    expect(sessionState()).toEqual(NO_SESSION);
  });
});

describe("signer", () => {
  it("refuses when nobody is signed in", async () => {
    await expect(signer()).rejects.toBeInstanceOf(SessionMissing);
  });

  it("refuses a key whose passphrase has not been given", async () => {
    writeSession(LOCAL);
    restoreSession();
    await expect(signer()).rejects.toBeInstanceOf(SessionLocked);
  });

  it("materialises once for however many callers ask at the same moment", async () => {
    remote.reconnect.mockResolvedValue(aSigner());
    writeSession(REMOTE);
    restoreSession();

    const [first, second] = await Promise.all([signer(), signer()]);
    expect(first).toBe(second);
    expect(remote.reconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the one it opened rather than opening another", async () => {
    remote.reconnect.mockResolvedValue(aSigner());
    writeSession(REMOTE);
    restoreSession();

    await signer();
    await signer();
    expect(remote.reconnect).toHaveBeenCalledTimes(1);
  });

  /**
   * The classic bug this is written against: caching the rejected promise, which
   * turns one unreachable moment into a session that can never be used again.
   */
  it("tries again after a failure instead of handing back the same refusal", async () => {
    remote.reconnect.mockRejectedValueOnce(new Error("the signer did not answer"));
    remote.reconnect.mockResolvedValueOnce(aSigner());
    writeSession(REMOTE);
    restoreSession();

    await expect(signer()).rejects.toThrow("the signer did not answer");
    expect(sessionState().status).toBe("failed");

    await expect(signer()).resolves.toBeDefined();
    expect(sessionState().status).toBe("ready");
  });

  it("passes an approval address on to whoever is watching", async () => {
    remote.reconnect.mockImplementation(async (_session, options) => {
      options?.onAuthUrl?.("https://nsec.app/approve/1");
      return aSigner();
    });
    writeSession(REMOTE);
    restoreSession();

    const opening = signer();
    await vi.waitFor(() => expect(sessionState().authUrl).toBe("https://nsec.app/approve/1"));
    await opening;
    // Cleared once it has been approved: it is an instruction, not a state.
    expect(sessionState().authUrl).toBeNull();
  });
});

describe("signInWithExtension", () => {
  it("takes the key the extension answers with", async () => {
    extension.extensionSigner.mockResolvedValue(aSigner(OTHER));
    await signInWithExtension();

    expect(sessionState()).toMatchObject({ pubkey: OTHER, method: "extension", status: "ready" });
  });

  it("survives a reload, because it was written down", async () => {
    extension.extensionSigner.mockResolvedValue(aSigner(OTHER));
    await signInWithExtension();

    clearSession();
    expect(sessionState().pubkey).toBeNull();
    restoreSession();
    expect(sessionState().pubkey).toBe(OTHER);
  });

  it("says what went wrong and signs nobody in", async () => {
    extension.extensionSigner.mockRejectedValue(new Error("no signing extension answered"));
    await expect(signInWithExtension()).rejects.toThrow();

    expect(sessionState().status).toBe("failed");
    expect(sessionState().pubkey).toBeNull();
  });
});

describe("signInWithSecretKey", () => {
  const nsec = "nsec1e7qh9vwrqc7xas0ggykxu9at57mvarls2ef37mfkk0q4uptyy0tsse62za";

  it("takes a key with no passphrase, and stores the key", async () => {
    await signInWithSecretKey(nsec);

    expect(sessionState().status).toBe("ready");
    const stored = JSON.parse(localStorage.getItem("openspecs:session") ?? "{}");
    expect(stored.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.ncryptsec).toBeUndefined();
  });

  it("takes a key with a passphrase, and stores no key", async () => {
    await signInWithSecretKey(nsec, "a good long passphrase");

    expect(sessionState().status).toBe("ready");
    const stored = JSON.parse(localStorage.getItem("openspecs:session") ?? "{}");
    expect(stored.ncryptsec).toMatch(/^ncryptsec1/);
    expect(stored.secret).toBeUndefined();
  });

  /** Four, so a PIN counts. Three is not a choice, it is a misunderstanding. */
  it("takes a PIN", async () => {
    await signInWithSecretKey(nsec, "1234");
    expect(sessionState().status).toBe("ready");
    expect(JSON.parse(localStorage.getItem("openspecs:session") ?? "{}").ncryptsec).toMatch(
      /^ncryptsec1/,
    );
  });

  it("refuses one too short to be worth the trouble", async () => {
    await expect(signInWithSecretKey(nsec, "123")).rejects.toThrow(/characters or more/);
    expect(sessionState().pubkey).toBeNull();
  });

  it("refuses anything that is not a private key", async () => {
    await expect(signInWithSecretKey("hunter2")).rejects.toThrow("that is not a private key");
  });
});

const storedRecord = () => JSON.parse(localStorage.getItem("openspecs:session") ?? "{}");

describe("signInWithNewKey", () => {
  it("signs in a key nobody had to bring, and keeps the key itself", () => {
    const pubkey = signInWithNewKey();

    expect(sessionState()).toMatchObject({ pubkey, method: "key", status: "ready" });
    expect(storedRecord().secret).toMatch(/^[0-9a-f]{64}$/);
    expect(storedRecord().ncryptsec).toBeUndefined();
  });

  it("signs under the key it returned", async () => {
    const pubkey = signInWithNewKey();
    const ready = await signer();
    const event = await ready.signEvent({ kind: 1, content: "", tags: [], created_at: 0 });

    expect(event.pubkey).toBe(pubkey);
  });

  it("is still there after a reload, since nothing was left to be unlocked", async () => {
    const pubkey = signInWithNewKey();

    clearSession();
    restoreSession();
    expect(sessionState()).toMatchObject({ pubkey, method: "key" });
    await expect(signer()).resolves.toBeDefined();
  });

  it("makes a different key every time", () => {
    const first = signInWithNewKey();
    clearSession();
    expect(signInWithNewKey()).not.toBe(first);
  });
});

describe("sessionNsec", () => {
  it("is the key this tab is holding, and is that key", () => {
    const pubkey = signInWithNewKey();
    const written = sessionNsec();

    expect(written).toMatch(/^nsec1/);
    expect(publicKeyOf(parseSecretKey(written ?? "") ?? new Uint8Array())).toBe(pubkey);
  });

  it("has nothing to show for a session that never held a key", async () => {
    expect(sessionNsec()).toBeNull();

    extension.extensionSigner.mockResolvedValue(aSigner());
    await signInWithExtension();
    expect(sessionNsec()).toBeNull();
  });

  it("has nothing to show for a key nobody has unlocked", () => {
    writeSession(LOCAL);
    restoreSession();
    expect(sessionNsec()).toBeNull();
  });

  it("has nothing to show once its reader has gone", async () => {
    signInWithNewKey();
    await logout();
    expect(sessionNsec()).toBeNull();
  });
});

describe("protectKey", () => {
  it("puts a passphrase on a key that arrived without one", async () => {
    signInWithNewKey();
    await protectKey("1234");

    expect(storedRecord().ncryptsec).toMatch(/^ncryptsec1/);
    expect(storedRecord().secret).toBeUndefined();
  });

  /** The passphrase is for the next visit. This one was already granted. */
  it("leaves the session signing, and the key readable", async () => {
    const pubkey = signInWithNewKey();
    const written = sessionNsec();
    await protectKey("1234");

    expect(sessionState()).toMatchObject({ pubkey, status: "ready" });
    expect(sessionNsec()).toBe(written);
    await expect(signer()).resolves.toBeDefined();
  });

  it("asks again on the next visit, and opens on the same passphrase", async () => {
    const pubkey = signInWithNewKey();
    await protectKey("1234");

    clearSession();
    restoreSession();
    expect(sessionState()).toMatchObject({ pubkey, method: "key", status: "locked" });

    await unlock("1234");
    expect(sessionState().status).toBe("ready");
  });

  it("refuses one too short, and leaves the key it already had alone", async () => {
    signInWithNewKey();
    await expect(protectKey("123")).rejects.toThrow(/characters or more/);

    expect(storedRecord().secret).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionState().status).toBe("ready");
  });

  it("has nothing to protect when nobody is signed in", async () => {
    await expect(protectKey("1234")).rejects.toThrow(SessionMissing);
  });

  it("cannot protect a key it cannot read", async () => {
    writeSession(LOCAL);
    restoreSession();
    await expect(protectKey("1234")).rejects.toThrow(SessionLocked);
  });
});

describe("logout", () => {
  it("signs out before it tells the signer, so a silent one cannot hold anyone", async () => {
    let told = false;
    remote.reconnect.mockResolvedValue({
      ...aSigner(),
      // A signer that never answers, which is the case this ordering is for.
      logout: () => {
        told = true;
        return new Promise<void>(() => {});
      },
    });
    writeSession(REMOTE);
    restoreSession();
    await signer();

    const seen: (string | null)[] = [];
    const stop = subscribeSession(() => seen.push(sessionState().pubkey));

    const leaving = logout();
    expect(sessionState()).toEqual(NO_SESSION);
    expect(seen).toEqual([null]);

    await leaving;
    expect(told).toBe(true);
    stop();
  });

  it("forgets the record, so the next load starts signed out", async () => {
    extension.extensionSigner.mockResolvedValue(aSigner());
    await signInWithExtension();
    await logout();

    clearSession();
    restoreSession();
    expect(sessionState()).toEqual(NO_SESSION);
  });

  it("tells a remote signer to revoke this app's key rather than merely forgetting it", async () => {
    const goodbye = vi.fn().mockResolvedValue(undefined);
    remote.reconnect.mockResolvedValue({ ...aSigner(), logout: goodbye });
    writeSession(REMOTE);
    restoreSession();
    await signer();

    await logout();
    expect(goodbye).toHaveBeenCalled();
    expect(remote.closeSignerPool).toHaveBeenCalled();
  });
});
