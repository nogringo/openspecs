import { toNpub } from "@openspecs/nostr";
import { decode } from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";
import type { Corpus } from "./manifest.ts";

/** One variable per corpus, so a key can only ever sign the corpus it was made for. */
export const keyVariable = (name: string): string => `OPENSPECS_IMPORT_KEY_${name.toUpperCase()}`;

/** An nsec, or the same key in hex, which is what the crawler takes for its own key. */
const toSecret = (value: string): Uint8Array | null => {
  if (/^[0-9a-f]{64}$/i.test(value)) return hexToBytes(value.toLowerCase());
  try {
    const decoded = decode(value);
    return decoded.type === "nsec" ? decoded.data : null;
  } catch {
    return null;
  }
};

/**
 * The key a corpus is signed with, read from the environment and never from a
 * file this repository holds.
 *
 * The check against the manifest is the one that matters. A corpus published
 * under the wrong key is not a mistake anyone can take back: the coordinates
 * belong to that key, the documents are already mirrored, and the only remedy
 * is to withdraw a hundred documents and publish them again somewhere else. So
 * the key proves it is the one the manifest names before it signs anything.
 */
export const secretFor = (corpus: Corpus, env: NodeJS.ProcessEnv = process.env): Uint8Array => {
  const variable = keyVariable(corpus.name);
  const value = (env[variable] ?? "").trim();
  if (value === "") throw new Error(`${variable} is not set, and ${corpus.name} cannot be signed`);

  const secret = toSecret(value);
  if (secret === null) throw new Error(`${variable} is neither an nsec nor a key in hex`);

  const pubkey = getPublicKey(secret);
  if (pubkey !== corpus.pubkey) {
    throw new Error(
      `${variable} signs as ${toNpub(pubkey)}, and ${corpus.name}.json names ${corpus.npub}`,
    );
  }

  return secret;
};
