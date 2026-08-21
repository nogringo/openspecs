import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import {
  clearPendingConnect,
  clearStoredSession,
  readSession,
  type StoredSession,
  writePendingConnect,
  writeSession,
} from "./session-store";
import { type AppSigner, SessionLocked, SessionMissing, type SignerMethod } from "./signer";
import { extensionSigner } from "./signer-extension";
import {
  decryptSecretKey,
  encryptSecretKey,
  keySigner,
  parseSecretKey,
  publicKeyOf,
} from "./signer-key";
import {
  awaitConnect,
  type ConnectAttempt,
  closeSignerPool,
  connectToBunker,
  parseBunker,
  reconnect,
  startConnect,
} from "./signer-remote";

export type SessionStatus =
  /** A key is known and nothing is open yet, which is where a reload lands. */
  "locked" | "connecting" | "ready" | "failed";

export type SessionState = {
  /** Null means signed out. Nothing else here means anything until it is set. */
  pubkey: string | null;
  method: SignerMethod | null;
  status: SessionStatus;
  /** A remote signer asking its owner to approve, in words a reader can click. */
  authUrl: string | null;
  /** What went wrong last, shown beside whatever caused it. */
  error: string | null;
};

export const NO_SESSION: SessionState = Object.freeze({
  pubkey: null,
  method: null,
  status: "locked",
  authUrl: null,
  error: null,
});

let state = NO_SESSION;
let stored: StoredSession | null = null;
let live: AppSigner | null = null;
let opening: Promise<AppSigner> | null = null;
/** Only for a key on this device, only in memory, and never written anywhere. */
let secret: Uint8Array | null = null;
let restored = false;

const listeners = new Set<() => void>();

export const subscribeSession = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const sessionState = (): SessionState => state;

/** The server signs nothing and knows nobody: every page it renders is signed out. */
export const serverSessionState = (): SessionState => NO_SESSION;

const publish = (next: Partial<SessionState>): void => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

const said = (reason: unknown): string => {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message.trim() === "" ? "the signer did not answer" : message.trim();
};

/**
 * Read from storage exactly once, from a mount effect and never from a snapshot:
 * the server renders a signed out page, and the first client render has to agree
 * with it before anything is allowed to change.
 *
 * An extension is settled straight away, because asking whether one exists costs
 * nothing and prompts nobody. The other two are left locked: a reader who came
 * to read should not pay a round trip to a remote signer, nor be asked for a
 * passphrase, before they have asked to sign anything.
 */
export const restoreSession = (): void => {
  if (restored || typeof window === "undefined") return;
  restored = true;

  stored = readSession();
  if (stored === null) return;

  // A key kept without a passphrase is already usable, so there is nothing to
  // unlock and nothing to ask for.
  if (stored.method === "key" && "secret" in stored) secret = hexToBytes(stored.secret);

  publish({ pubkey: stored.pubkey, method: stored.method, status: "locked", error: null });
  if (stored.method === "extension" || secret !== null) void signer().catch(() => {});
};

/** Opens the channel ahead of the click that will need it. Safe to call often. */
export const warmSession = (): void => {
  if (stored === null || live !== null || opening !== null) return;
  if (stored.method === "key" && secret === null) return;
  void signer().catch(() => {});
};

const open = async (record: StoredSession): Promise<AppSigner> => {
  if (record.method === "extension") return extensionSigner();
  if (record.method === "key") {
    if (secret === null) throw new SessionLocked();
    return keySigner(secret);
  }
  return reconnect(
    { pointer: record.bunker, clientSecret: record.clientSecret },
    { onAuthUrl: (url) => publish({ authUrl: url }) },
  );
};

/**
 * Materialised on first use and kept, with concurrent callers sharing the one
 * attempt. A failed attempt is dropped rather than remembered: a remote signer
 * that was unreachable once must be reachable again without signing in afresh.
 */
export const signer = (): Promise<AppSigner> => {
  if (live !== null) return Promise.resolve(live);
  if (opening !== null) return opening;

  const record = stored;
  if (record === null) return Promise.reject(new SessionMissing());
  if (record.method === "key" && secret === null) return Promise.reject(new SessionLocked());

  publish({ status: "connecting", error: null });
  opening = open(record)
    .then((ready) => {
      live = ready;
      opening = null;
      publish({ status: "ready", authUrl: null, error: null });
      return ready;
    })
    .catch((reason: unknown) => {
      live = null;
      opening = null;
      publish({ status: "failed", error: said(reason) });
      throw reason;
    });
  return opening;
};

const remember = (record: StoredSession, ready: AppSigner): void => {
  stored = record;
  live = ready;
  writeSession(record);
  publish({ pubkey: record.pubkey, method: record.method, status: "ready", error: null });
};

export const signInWithExtension = async (): Promise<void> => {
  publish({ status: "connecting", error: null });
  try {
    const ready = await extensionSigner();
    const pubkey = await ready.getPublicKey();
    remember({ v: 1, method: "extension", pubkey }, ready);
  } catch (reason) {
    publish({ status: "failed", error: said(reason) });
    throw reason;
  }
};

export const signInWithBunker = async (input: string): Promise<void> => {
  publish({ status: "connecting", error: null });
  try {
    const pointer = await parseBunker(input);
    if (pointer === null) throw new Error("that is not a bunker address");

    const {
      signer: ready,
      session,
      pubkey,
    } = await connectToBunker(pointer, {
      onAuthUrl: (url) => publish({ authUrl: url }),
    });
    remember(
      {
        v: 1,
        method: "remote",
        pubkey,
        bunker: session.pointer,
        clientSecret: session.clientSecret,
      },
      ready,
    );
  } catch (reason) {
    publish({ status: "failed", error: said(reason) });
    throw reason;
  }
};

/**
 * The scanned form. The URI is handed back at once so it can be drawn, and the
 * promise settles when a signer has answered it.
 */
export const signInWithConnect = async (
  options: { signal?: AbortSignal } = {},
): Promise<{ uri: string; connected: Promise<void> }> => {
  const attempt: ConnectAttempt = await startConnect();
  writePendingConnect({ v: 1, ...attempt });
  publish({ status: "connecting", error: null });

  const connected = awaitConnect(attempt, {
    signal: options.signal,
    onAuthUrl: (url) => publish({ authUrl: url }),
  })
    .then(({ signer: ready, session, pubkey }) => {
      clearPendingConnect();
      remember(
        {
          v: 1,
          method: "remote",
          pubkey,
          bunker: session.pointer,
          clientSecret: session.clientSecret,
        },
        ready,
      );
    })
    .catch((reason: unknown) => {
      clearPendingConnect();
      publish({ status: "failed", error: said(reason) });
      throw reason;
    });

  return { uri: attempt.uri, connected };
};

/**
 * Four, so a PIN counts. Shorter than a passphrase anyone would call one, and
 * that is the point: what stands between a key and whoever picks up the device
 * is a choice its owner makes, and four digits they will actually type beat
 * twelve characters they answer by declining.
 */
export const MIN_PASSPHRASE = 4;

/**
 * The passphrase is offered, never required. With one, what is stored is a NIP-49
 * `ncryptsec` and the key is asked for again on every visit. Without one, the key
 * itself is what sits on this device, which is the trade its owner made.
 */
export const signInWithSecretKey = async (input: string, passphrase = ""): Promise<void> => {
  publish({ status: "connecting", error: null });
  try {
    const key = parseSecretKey(input);
    if (key === null) throw new Error("that is not a private key");

    const pubkey = publicKeyOf(key);
    if (passphrase === "") {
      secret = key;
      remember({ v: 1, method: "key", pubkey, secret: bytesToHex(key) }, keySigner(key));
      return;
    }

    if (passphrase.length < MIN_PASSPHRASE) {
      throw new Error(`a PIN or passphrase needs ${MIN_PASSPHRASE} characters or more`);
    }
    const ncryptsec = await encryptSecretKey(key, passphrase);
    secret = key;
    remember({ v: 1, method: "key", pubkey, ncryptsec }, keySigner(key));
  } catch (reason) {
    publish({ status: "failed", error: said(reason) });
    throw reason;
  }
};

/**
 * The key is decrypted once per tab and held in memory. Nothing writes it back
 * out: a hard reload asks again, which is the price of never leaving a usable
 * key on disk.
 */
export const unlock = async (passphrase: string): Promise<void> => {
  const record = stored;
  if (record === null || record.method !== "key" || !("ncryptsec" in record)) {
    throw new SessionMissing();
  }

  publish({ status: "connecting", error: null });
  try {
    secret = await decryptSecretKey(record.ncryptsec, passphrase);
    live = keySigner(secret);
    publish({ status: "ready", error: null });
  } catch {
    secret = null;
    publish({ status: "locked", error: "that does not open this key" });
    throw new SessionLocked();
  }
};

/**
 * Signed out here first and told to the remote signer after, behind a deadline.
 * Revoking this app's key is what makes a remote logout mean something, but a
 * signer that never answers must not be able to keep somebody signed in.
 */
export const logout = async (): Promise<void> => {
  const closing = live;
  live = null;
  opening = null;
  secret?.fill(0);
  secret = null;
  stored = null;
  clearStoredSession();
  clearPendingConnect();
  state = NO_SESSION;
  for (const listener of listeners) listener();

  try {
    const goodbye =
      closing !== null && "logout" in closing && typeof closing.logout === "function"
        ? (closing as { logout: () => Promise<void> }).logout()
        : (closing?.close?.() ?? Promise.resolve());
    await Promise.race([goodbye, new Promise((resolve) => setTimeout(resolve, 2000))]);
  } catch {}
  closeSignerPool();
};

/** Test seam, and what a page with no reader left on it eventually calls. */
export const clearSession = (): void => {
  live = null;
  opening = null;
  secret = null;
  stored = null;
  restored = false;
  state = NO_SESSION;
};
