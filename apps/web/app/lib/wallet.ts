import { parseWalletConnect, type WalletConnection } from "@openspecs/nostr";

const WALLET_KEY = "openspecs:wallet";

/**
 * A connection string is a spending credential, and this keeps it in plain
 * `localStorage`, which is the weakest thing in this app. It is written down
 * knowingly rather than dressed up:
 *
 * - anything running on this page can read it, so an injected script drains
 *   whatever the connection allows;
 * - encrypting it under a passphrase would ask for one from readers who signed
 *   in with an extension and have none, and would still be decrypted in this
 *   same page to be used;
 * - the answer that actually helps is a budgeted connection, which every wallet
 *   worth connecting can issue, and the interface says so where it asks.
 *
 * The better place for this is a NIP-78 record encrypted to the reader's own key
 * through their signer, which would also follow them between devices. That needs
 * `nip44Encrypt` on the signer first, and is the next thing to build here.
 */
const store = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

const listeners = new Set<() => void>();

let connection: WalletConnection | null = null;
let read = false;

export const subscribeWallet = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** Parsed on the way out as well as in, so a stored string that rots is ignored. */
export const wallet = (): WalletConnection | null => {
  if (!read) {
    read = true;
    try {
      const raw = store()?.getItem(WALLET_KEY);
      connection = raw === null || raw === undefined ? null : parseWalletConnect(raw);
    } catch {
      connection = null;
    }
  }
  return connection;
};

/** The server has no wallet and never will: it does not spend anybody's money. */
export const serverWallet = (): WalletConnection | null => null;

export const connectWallet = (input: string): WalletConnection | null => {
  const parsed = parseWalletConnect(input);
  if (parsed === null) return null;

  connection = parsed;
  read = true;
  try {
    store()?.setItem(WALLET_KEY, input.trim());
  } catch {}
  notify();
  return parsed;
};

export const forgetWallet = (): void => {
  connection = null;
  read = true;
  try {
    store()?.removeItem(WALLET_KEY);
  } catch {}
  notify();
};

/** The host a reader can recognise their wallet by, without showing the key. */
export const walletHost = (held: WalletConnection | null): string =>
  held === null ? "" : (held.relays[0] ?? "").replace(/^wss?:\/\//, "").replace(/\/$/, "");
