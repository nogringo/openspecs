import {
  BLOSSOM_AUTH_KIND,
  BLOSSOM_SERVER_KIND,
  PROFILE_KIND,
  RELAY_LIST_KIND,
  SPEC_KIND,
} from "@openspecs/nostr";
import type { BunkerPointer, BunkerSigner } from "nostr-tools/nip46";
import type { AppSigner } from "./signer";

/**
 * Where a `nostrconnect://` handshake is listened for. Both sides have to reach
 * the same relay, so this is a list of relays that answer rather than a list of
 * relays meant for signing: `relay.nsec.app` and `relay.nsecbunker.com`, which
 * signing apps used to default to, are both gone.
 *
 * A handshake lasts seconds and carries nothing but an encrypted greeting, so an
 * ordinary relay does the job. This is still a point of centralisation, which is
 * why the pasted `bunker://` form sits beside it: that one names its own.
 */
export const CONNECT_RELAYS = [
  "wss://promenade.fiatjaf.com",
  "wss://relay.ditto.pub",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

/**
 * What this app asks a remote signer for, and nothing beyond it. Asked once, at
 * the handshake: a session connected before a kind was added here is one whose
 * signer will ask its owner about that kind every time, which is a signer doing
 * its job rather than a bug on this side.
 */
const PERMISSIONS = [
  `sign_event:${SPEC_KIND}`,
  "sign_event:1111",
  "sign_event:7",
  "sign_event:5",
  "sign_event:9734",
  `sign_event:${PROFILE_KIND}`,
  `sign_event:${RELAY_LIST_KIND}`,
  // An upload token, which is signed and handed to a server rather than published.
  `sign_event:${BLOSSOM_AUTH_KIND}`,
  // The servers holding a picture, without which its copies cannot be found.
  `sign_event:${BLOSSOM_SERVER_KIND}`,
];

export type RemoteSession = {
  pointer: { pubkey: string; relays: string[] };
  /** This app's own key for talking to the signer. Never the reader's. */
  clientSecret: string;
};

export type RemoteSigner = AppSigner & { logout: () => Promise<void> };

export type ConnectOptions = {
  /** A signer asking its owner to approve in a tab. Rendered as a link to click. */
  onAuthUrl?: (url: string) => void;
};

/**
 * Its own pool. Bunker relays are a different set with a different lifetime from
 * the ones documents are read on, and `closeRelayPool` must not be able to hang
 * up the channel a signature is travelling over.
 */
let pool: import("nostr-tools/abstract-pool").AbstractSimplePool | null = null;

const signerPool = async () => {
  if (pool === null) {
    const { SimplePool } = await import("nostr-tools/pool");
    pool = new SimplePool();
  }
  return pool;
};

export const closeSignerPool = (): void => {
  pool?.destroy();
  pool = null;
};

/** Accepts a `bunker://` URI or a signer's NIP-05 name. Null for anything else. */
export const parseBunker = async (input: string): Promise<BunkerPointer | null> => {
  const { parseBunkerInput } = await import("nostr-tools/nip46");
  try {
    return await parseBunkerInput(input.trim());
  } catch {
    return null;
  }
};

const clientMetadata = () => ({
  name: "Open Specs",
  url: typeof window === "undefined" ? "" : window.location.origin,
  image: typeof window === "undefined" ? "" : `${window.location.origin}/icon.svg`,
});

const wrap = (signer: BunkerSigner): RemoteSigner => ({
  getPublicKey: () => signer.getPublicKey(),
  signEvent: (draft) => signer.signEvent(draft),
  logout: () => signer.logout(),
  close: () => signer.close(),
});

export type ConnectAttempt = {
  /** The URI to draw as a QR, for the signer to scan. */
  uri: string;
  clientSecret: string;
  relays: string[];
};

/**
 * Half of the QR flow: the URI is made here and shown, and nothing is listened
 * for until `awaitConnect` is called with it. Split in two so the URI can be
 * drawn the instant the dialog opens.
 */
export const startConnect = async (relays: string[] = CONNECT_RELAYS): Promise<ConnectAttempt> => {
  const [{ createNostrConnectURI }, { generateSecretKey, getPublicKey }, { bytesToHex }] =
    await Promise.all([
      import("nostr-tools/nip46"),
      import("nostr-tools/pure"),
      import("nostr-tools/utils"),
    ]);

  const secret = generateSecretKey();
  const challenge = bytesToHex(generateSecretKey()).slice(0, 32);

  return {
    uri: createNostrConnectURI({
      clientPubkey: getPublicKey(secret),
      relays,
      secret: challenge,
      perms: PERMISSIONS,
      ...clientMetadata(),
    }),
    clientSecret: bytesToHex(secret),
    relays,
  };
};

export type Connected = { signer: RemoteSigner; session: RemoteSession; pubkey: string };

/**
 * The other half: waits for the signer that scanned the URI to answer.
 *
 * What comes back matters as much as the signature. `fromURI` resolves the real
 * pointer, which the URI never carried because the signer's own key was unknown
 * when it was made, and it is that pointer which lets a reload reconnect without
 * scanning anything again. The key is asked for separately, since a signer's own
 * key and the key it signs as are not always the same one.
 */
export const awaitConnect = async (
  attempt: ConnectAttempt,
  options: ConnectOptions & { signal?: AbortSignal } = {},
): Promise<Connected> => {
  const [{ BunkerSigner }, { hexToBytes }] = await Promise.all([
    import("nostr-tools/nip46"),
    import("nostr-tools/utils"),
  ]);

  let signer: BunkerSigner;
  try {
    signer = await BunkerSigner.fromURI(
      hexToBytes(attempt.clientSecret),
      attempt.uri,
      { pool: await signerPool(), onauth: options.onAuthUrl },
      options.signal,
    );
  } catch (reason) {
    // What the library says when the handshake relays dropped it is true and
    // unusable: nobody can act on a subscription. What a reader can act on is
    // whether their signing app is open and looking at this code.
    throw new Error(
      options.signal?.aborted === true
        ? "the code was closed before a signer answered"
        : "no signer answered this code",
      { cause: reason },
    );
  }

  const pubkey = await signer.getPublicKey();
  return {
    signer: wrap(signer),
    // The challenge is single use, so it is not carried into the session: what a
    // reconnection needs is the pointer and this app's own key.
    session: {
      pointer: { pubkey: signer.bp.pubkey, relays: signer.bp.relays },
      clientSecret: attempt.clientSecret,
    },
    pubkey,
  };
};

/** The pasted form, where the signer's key is known before anything is opened. */
export const connectToBunker = async (
  pointer: BunkerPointer,
  options: ConnectOptions = {},
): Promise<Connected> => {
  const [{ BunkerSigner }, { generateSecretKey }, { bytesToHex, hexToBytes }] = await Promise.all([
    import("nostr-tools/nip46"),
    import("nostr-tools/pure"),
    import("nostr-tools/utils"),
  ]);

  const clientSecret = bytesToHex(generateSecretKey());
  const signer = BunkerSigner.fromBunker(hexToBytes(clientSecret), pointer, {
    pool: await signerPool(),
    onauth: options.onAuthUrl,
  });

  await signer.connect(clientMetadata());
  const pubkey = await signer.getPublicKey();
  return {
    signer: wrap(signer),
    session: { pointer: { pubkey: pointer.pubkey, relays: pointer.relays }, clientSecret },
    pubkey,
  };
};

/**
 * Reopening a session read back from storage. It pings, so a signer that is no
 * longer there fails here rather than under the first thing a reader tried to
 * sign.
 */
export const reconnect = async (
  session: RemoteSession,
  options: ConnectOptions = {},
): Promise<RemoteSigner> => {
  const [{ BunkerSigner }, { hexToBytes }] = await Promise.all([
    import("nostr-tools/nip46"),
    import("nostr-tools/utils"),
  ]);

  const signer = BunkerSigner.fromBunker(
    hexToBytes(session.clientSecret),
    { ...session.pointer, secret: null },
    { pool: await signerPool(), onauth: options.onAuthUrl },
  );

  await signer.ping();
  return wrap(signer);
};
