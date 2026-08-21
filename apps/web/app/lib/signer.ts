import type { EventDraft, NostrEvent } from "@openspecs/nostr";

/** How a key was reached. Not a preference: the three behave differently. */
export type SignerMethod = "extension" | "remote" | "key";

export type SignerDraft = EventDraft & { created_at: number };

/**
 * What this app needs of a signer, which is less than nostr-tools' own `Signer`
 * plus a way to hang up. An extension has no session to close, so `close` is
 * optional rather than a no-op every caller has to remember to think about.
 *
 * Structurally what `nostr-tools/signer` describes, so a `BunkerSigner` and a
 * `PlainKeySigner` satisfy it with no adapter in between.
 */
export type AppSigner = {
  getPublicKey: () => Promise<string>;
  signEvent: (draft: SignerDraft) => Promise<NostrEvent>;
  close?: () => Promise<void>;
};

/** Nobody is signed in, so there is nothing to sign with. */
export class SessionMissing extends Error {
  constructor() {
    super("no key is connected");
    this.name = "SessionMissing";
  }
}

/** The key is on this device under a passphrase, and the passphrase is not in memory. */
export class SessionLocked extends Error {
  constructor() {
    super("this key is locked");
    this.name = "SessionLocked";
  }
}

/**
 * The signer answered with a key other than the one this session was opened
 * for, which means its owner switched accounts somewhere else.
 */
export class SessionMismatch extends Error {
  constructor() {
    super("the signer is signed in as a different key");
    this.name = "SessionMismatch";
  }
}

/** What the three methods are called where a reader can see them. */
export const METHOD_NAMES: Record<SignerMethod, string> = {
  extension: "browser extension",
  remote: "remote signer",
  key: "key on this device",
};
