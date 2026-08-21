import { decode, nsecEncode } from "nostr-tools/nip19";
import { decrypt, encrypt } from "nostr-tools/nip49";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { hexToBytes, isHex32 } from "nostr-tools/utils";
import type { AppSigner } from "./signer";

/** Accepts an nsec or a bare hex key. An npub is a public key, so it returns null. */
export const parseSecretKey = (input: string): Uint8Array | null => {
  const value = input.trim().replace(/^nostr:/i, "");
  if (isHex32(value.toLowerCase())) return hexToBytes(value.toLowerCase());

  try {
    const decoded = decode(value.toLowerCase());
    return decoded.type === "nsec" ? decoded.data : null;
  } catch {
    return null;
  }
};

/** A key nobody brought here, from the same generator nostr-tools signs with. */
export const newSecretKey = (): Uint8Array => generateSecretKey();

/** The written form, which is the only form a person can copy down. */
export const toNsec = (secret: Uint8Array): string => nsecEncode(secret);

export const publicKeyOf = (secret: Uint8Array): string => getPublicKey(secret);

/**
 * `ksb` says how the client handles the key once it has it. A browser cannot
 * honestly claim it never leaves the encrypted form, so `0x02`, "the client does
 * not track this", is the value that is true.
 *
 * Both wrappers are async over a synchronous scrypt that seizes the main thread
 * for about a second at the default cost. They yield a macrotask first, so the
 * state that says what is happening is painted before it does.
 */
export const encryptSecretKey = async (
  secret: Uint8Array,
  passphrase: string,
  logn?: number,
): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return encrypt(secret, passphrase, logn, 0x02);
};

export const decryptSecretKey = async (
  ncryptsec: string,
  passphrase: string,
): Promise<Uint8Array> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return decrypt(ncryptsec, passphrase);
};

/** The one signer that needs nothing outside this tab, and holds the key to prove it. */
export const keySigner = (secret: Uint8Array): AppSigner => ({
  getPublicKey: async () => getPublicKey(secret),
  signEvent: async (draft) => finalizeEvent(draft, secret),
});
