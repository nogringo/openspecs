import type { SignerMethod } from "./signer";

const SESSION_KEY = "openspecs:session";
const PENDING_KEY = "openspecs:connect";

export const SESSION_VERSION = 1;

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * What survives a reload, per method.
 *
 * `extension` keeps a key and nothing else: an injected extension can be asked
 * again for free. `remote` keeps this app's own key for talking to the signer,
 * which is a credential, and one that the signer can revoke, which is why
 * logging out tells it to rather than merely forgetting it here.
 *
 * `key` comes in two shapes, because a passphrase is offered and not imposed:
 * a NIP-49 `ncryptsec`, which is the key under one, or the key itself. The
 * second is what somebody who declined a passphrase asked for, and the interface
 * says what it means before they do.
 */
export type StoredSession =
  | { v: 1; method: "extension"; pubkey: string }
  | {
      v: 1;
      method: "remote";
      pubkey: string;
      bunker: { pubkey: string; relays: string[] };
      clientSecret: string;
    }
  | { v: 1; method: "key"; pubkey: string; ncryptsec: string }
  | { v: 1; method: "key"; pubkey: string; secret: string };

/** A handshake nobody has scanned yet. It belongs to this tab and dies with it. */
export type PendingConnect = { v: 1; uri: string; clientSecret: string; relays: string[] };

const asRelays = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const relays = value.filter((url): url is string => typeof url === "string" && url !== "");
  return relays.length === value.length ? relays : null;
};

/**
 * Written by hand rather than with zod, which is not a dependency of this app,
 * in the shape `parseRelayList` already uses. The same parser guards the write,
 * so a shape that changes can never leave a record nothing is able to read.
 */
export const parseStoredSession = (input: unknown): StoredSession | null => {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (record.v !== SESSION_VERSION) return null;

  const pubkey = typeof record.pubkey === "string" ? record.pubkey.toLowerCase() : "";
  if (!HEX_64.test(pubkey)) return null;

  const method = record.method as SignerMethod;
  if (method === "extension") return { v: 1, method, pubkey };

  if (method === "key") {
    const ncryptsec = typeof record.ncryptsec === "string" ? record.ncryptsec : "";
    if (ncryptsec.startsWith("ncryptsec1")) return { v: 1, method, pubkey, ncryptsec };

    const secret = typeof record.secret === "string" ? record.secret.toLowerCase() : "";
    return HEX_64.test(secret) ? { v: 1, method, pubkey, secret } : null;
  }

  if (method === "remote") {
    const bunker = record.bunker as Record<string, unknown> | undefined;
    const bunkerPubkey = typeof bunker?.pubkey === "string" ? bunker.pubkey.toLowerCase() : "";
    const relays = asRelays(bunker?.relays);
    const clientSecret =
      typeof record.clientSecret === "string" ? record.clientSecret.toLowerCase() : "";
    if (!HEX_64.test(bunkerPubkey) || relays === null || !HEX_64.test(clientSecret)) return null;
    return { v: 1, method, pubkey, bunker: { pubkey: bunkerPubkey, relays }, clientSecret };
  }

  return null;
};

export const parsePendingConnect = (input: unknown): PendingConnect | null => {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (record.v !== SESSION_VERSION) return null;

  const uri = typeof record.uri === "string" ? record.uri : "";
  const clientSecret =
    typeof record.clientSecret === "string" ? record.clientSecret.toLowerCase() : "";
  const relays = asRelays(record.relays);
  if (!uri.startsWith("nostrconnect://") || !HEX_64.test(clientSecret) || relays === null) {
    return null;
  }
  return { v: 1, uri, clientSecret, relays };
};

/**
 * Storage is an accelerator, never a dependency, the stance `corpus-store` takes
 * too. Safari in a private window has a `localStorage` whose `setItem` throws,
 * so a session that cannot be written is a session that works until the tab is
 * closed rather than a page that does not load.
 */
const read = <T>(store: Storage | undefined, key: string, parse: (input: unknown) => T | null) => {
  try {
    const raw = store?.getItem(key);
    return raw === null || raw === undefined ? null : parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

const write = (store: Storage | undefined, key: string, value: unknown): void => {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {}
};

const remove = (store: Storage | undefined, key: string): void => {
  try {
    store?.removeItem(key);
  } catch {}
};

const local = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

const session = (): Storage | undefined =>
  typeof sessionStorage === "undefined" ? undefined : sessionStorage;

export const readSession = (): StoredSession | null =>
  read(local(), SESSION_KEY, parseStoredSession);

/** Refused unless it parses, so the same shape goes out as comes back in. */
export const writeSession = (stored: StoredSession): void => {
  if (parseStoredSession(stored) === null) return;
  write(local(), SESSION_KEY, stored);
};

export const clearStoredSession = (): void => remove(local(), SESSION_KEY);

export const readPendingConnect = (): PendingConnect | null =>
  read(session(), PENDING_KEY, parsePendingConnect);

export const writePendingConnect = (pending: PendingConnect): void => {
  if (parsePendingConnect(pending) === null) return;
  write(session(), PENDING_KEY, pending);
};

export const clearPendingConnect = (): void => remove(session(), PENDING_KEY);
