import { type EventDraft, type NostrEvent, newestEvent, nostrEventSchema } from "./event";
import { CLIENT_NAME } from "./nip22";
import { INDEXER_RELAYS } from "./nip65";
import { queryRelays, type RelayOptions, relaySet } from "./pool";

/** BUD-11: an authorization token is a signed event of this kind, never published. */
export const BLOSSOM_AUTH_KIND = 24242;

/** BUD-03: the servers a key names as its own, most trusted first. */
export const BLOSSOM_SERVER_KIND = 10063;

const SERVER_LIST_TIMEOUT_MS = 2000;
const SERVER_LIST_TTL_MS = 30 * 60 * 1000;

/** How long a token is good for. Long enough for a slow upload, short enough to be worth little. */
const AUTH_TTL_S = 300;

/**
 * How many other servers are asked for a picture that has gone. Not a limit on
 * how many hold it, which is the author's to decide and the more the better:
 * this bounds a browser drawing a page, where every try is a request that has to
 * fail before the next one starts and a mark shown late reads as a page still
 * loading. The copies are made in list order, so the first few are where a blob
 * is if it is anywhere.
 */
export const MAX_RECOVERY_TRIES = 4;

/**
 * Where a picture goes when a key has named no server of its own. All of them,
 * not the first that answers: these are public servers run by somebody else, and
 * the whole reason there is a list is that no one of them is to be relied on.
 */
export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.nmail.li",
  "https://blossom.yakihonne.com",
  "https://blossom.ditto.pub",
  "https://blossom.primal.net",
];

/** What a server answers an upload with. BUD-02. */
export type BlobDescriptor = {
  /** Carries a file extension, which is what lets the URL be embedded anywhere. */
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
};

export class BlossomError extends Error {
  constructor(
    readonly server: string,
    message: string,
  ) {
    super(message);
    this.name = "BlossomError";
  }
}

/**
 * https only, and the origin alone. A picture served over http is blocked as
 * mixed content on every page that would draw it, so a server named that way is
 * one whose uploads are invisible.
 */
export const serverOrigin = (value: string): string | null => {
  const raw = value.trim();
  if (raw === "") return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" ? `${url.protocol}//${url.host}` : null;
  } catch {
    return null;
  }
};

export const serverSet = (...lists: string[][]): string[] => {
  const origins = new Set<string>();
  for (const value of lists.flat()) {
    const origin = serverOrigin(value);
    if (origin !== null) origins.add(origin);
  }
  return [...origins];
};

export const sha256Hex = async (data: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * No `server` tag, which BUD-11 says leaves the token good anywhere. That is the
 * point here: one picture goes to every server on the list, and a token naming
 * one of them would mean a signing prompt per copy.
 */
export const buildUploadAuth = (sha256: string, expiresAt: number): EventDraft => ({
  kind: BLOSSOM_AUTH_KIND,
  // Shown to whoever is asked to approve this, so it says what it is for.
  content: "Upload your picture",
  tags: [
    ["t", "upload"],
    ["x", sha256],
    ["expiration", String(expiresAt)],
  ],
});

export const authExpiry = (): number => Math.floor(Date.now() / 1000) + AUTH_TTL_S;

/** Base64url without padding, the encoding BUD-11 names, over the whole signed event. */
export const authorizationHeader = (auth: NostrEvent): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(auth));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `Nostr ${base64}`;
};

const descriptorOf = (body: unknown, server: string): BlobDescriptor => {
  const blob = body as Partial<BlobDescriptor> | null;
  const url = typeof blob?.url === "string" ? blob.url.trim() : "";
  if (url === "" || !url.startsWith("https://")) {
    throw new BlossomError(server, "answered without a usable address for the file");
  }
  return {
    url,
    sha256: typeof blob?.sha256 === "string" ? blob.sha256 : "",
    size: typeof blob?.size === "number" ? blob.size : 0,
    type: typeof blob?.type === "string" ? blob.type : "application/octet-stream",
    uploaded: typeof blob?.uploaded === "number" ? blob.uploaded : Math.floor(Date.now() / 1000),
  };
};

/**
 * BUD-02, one server. `X-SHA-256` is sent so the server can refuse a file that
 * arrived changed rather than storing it under the wrong hash, and `X-Reason` is
 * read back because it is the only place a server says why it said no.
 */
export const uploadBlob = async (
  server: string,
  file: Blob,
  auth: NostrEvent,
  sha256: string,
  options: { signal?: AbortSignal } = {},
): Promise<BlobDescriptor> => {
  const origin = serverOrigin(server);
  if (origin === null) throw new BlossomError(server, "is not an https address");

  let response: Response;
  try {
    response = await fetch(`${origin}/upload`, {
      method: "PUT",
      body: file,
      signal: options.signal,
      headers: {
        Authorization: authorizationHeader(auth),
        "Content-Type": file.type === "" ? "application/octet-stream" : file.type,
        "X-SHA-256": sha256,
      },
    });
  } catch {
    throw new BlossomError(origin, "could not be reached");
  }

  if (!response.ok) {
    const said = (response.headers.get("X-Reason") ?? "").trim();
    throw new BlossomError(origin, said === "" ? `refused it (${response.status})` : said);
  }

  try {
    return descriptorOf(await response.json(), origin);
  } catch (reason) {
    if (reason instanceof BlossomError) throw reason;
    throw new BlossomError(origin, "answered with something this could not read");
  }
};

/**
 * BUD-04, the cheap copy: the destination fetches the blob from a server that
 * already holds it, so a picture crosses the reader's connection once however
 * many servers end up with it. The same `upload` token is what authorises it.
 *
 * Not every server implements this, which is why the caller falls back to
 * sending the file again.
 */
export const mirrorBlob = async (
  server: string,
  from: string,
  auth: NostrEvent,
  options: { signal?: AbortSignal } = {},
): Promise<BlobDescriptor> => {
  const origin = serverOrigin(server);
  if (origin === null) throw new BlossomError(server, "is not an https address");

  let response: Response;
  try {
    response = await fetch(`${origin}/mirror`, {
      method: "PUT",
      body: JSON.stringify({ url: from }),
      signal: options.signal,
      headers: {
        Authorization: authorizationHeader(auth),
        "Content-Type": "application/json",
      },
    });
  } catch {
    throw new BlossomError(origin, "could not be reached");
  }

  if (!response.ok) {
    const said = (response.headers.get("X-Reason") ?? "").trim();
    throw new BlossomError(origin, said === "" ? `refused it (${response.status})` : said);
  }

  try {
    return descriptorOf(await response.json(), origin);
  } catch (reason) {
    if (reason instanceof BlossomError) throw reason;
    throw new BlossomError(origin, "answered with something this could not read");
  }
};

/**
 * BUD-03. The order is the author's, most trusted first, and is kept.
 *
 * Uncapped: every caller that opens sockets or sends files bounds itself, and
 * this one is also what an author reads their own list back from to edit it,
 * where a server dropped on the way in is a server deleted on the way out.
 */
export const parseServerList = (input: unknown): string[] | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== BLOSSOM_SERVER_KIND) return null;

  return serverSet(
    parsed.data.tags.filter((tag) => tag[0] === "server").map((tag) => tag[1] ?? ""),
  );
};

/**
 * The event that makes the copies worth having. A picture is one URL in a
 * profile, so a reader whose server has gone is a reader with a broken image and
 * no way to know a copy exists: BUD-03 says a client takes the hash out of the
 * dead URL and walks this list. Without it, replicating is storage nobody can
 * find.
 *
 * Uncapped, like the list it was read from. How many servers an author wants to
 * be on is theirs to decide, and no bound this client draws pages with is a
 * reason to delete one they named: other clients read this list too.
 */
export const buildServerList = (servers: string[]): EventDraft => ({
  kind: BLOSSOM_SERVER_KIND,
  content: "",
  tags: [...serverSet(servers).map((url) => ["server", url]), ["client", CLIENT_NAME]],
});

/** A blob is addressed by its hash, with an extension only so browsers know what it is. */
const BLOB_PATH = /^\/([0-9a-f]{64})(\.[a-z0-9]+)?$/i;

/**
 * The hash a Blossom URL is addressed by. What makes a picture recoverable: any
 * server holding this blob serves it at the same path, so a dead address is
 * still a name for the thing rather than only a place it used to be.
 *
 * Null for a URL that is not one of these, which is most of the pictures in
 * profiles in the wild and nothing to be recovered.
 */
export const blobHash = (url: string): string | null => {
  try {
    return BLOB_PATH.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
};

/** The same blob elsewhere, in the order the author trusts, minus where it just failed. */
export const blobUrls = (url: string, servers: string[]): string[] => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  const found = BLOB_PATH.exec(parsed.pathname);
  const hash = found?.[1]?.toLowerCase();
  if (hash === undefined) return [];

  return serverSet(servers)
    .filter((server) => server !== parsed.origin)
    .slice(0, MAX_RECOVERY_TRIES)
    .map((server) => `${server}/${hash}${found?.[2] ?? ""}`);
};

/** Indexers serve stale revisions of a server list next to the live one, so the newest wins. */
export const selectServerLists = (events: unknown[]): Map<string, string[]> => {
  const newest = new Map<string, { createdAt: number; servers: string[] }>();
  for (const event of events) {
    const servers = parseServerList(event);
    const parsed = nostrEventSchema.safeParse(event);
    if (!servers || !parsed.success) continue;
    const current = newest.get(parsed.data.pubkey);
    if (!current || parsed.data.created_at > current.createdAt) {
      newest.set(parsed.data.pubkey, { createdAt: parsed.data.created_at, servers });
    }
  }
  return new Map([...newest].map(([pubkey, { servers }]) => [pubkey, servers]));
};

export type ServerListOptions = Omit<RelayOptions, "relays"> & { indexers?: string[] };

const ask = (pubkeys: string[], options: ServerListOptions) =>
  queryRelays(
    relaySet(options.indexers ?? INDEXER_RELAYS),
    { kinds: [BLOSSOM_SERVER_KIND], authors: pubkeys },
    { ...options, timeoutMs: options.timeoutMs ?? SERVER_LIST_TIMEOUT_MS },
  )
    .then(selectServerLists)
    .catch(() => new Map<string, string[]>());

/**
 * Uncached, and asked for at the moment somebody drops a file: this is read once
 * per upload rather than once per page, and a list half an hour old would send a
 * picture to a server its owner has since stopped using.
 */
export const fetchServerList = async (
  pubkey: string,
  options: ServerListOptions = {},
): Promise<string[]> => (await ask([pubkey], options)).get(pubkey) ?? [];

/**
 * The live event rather than the list in it, so an author editing their own can
 * be told apart from an author who has none: a form that cannot tell those two
 * apart offers to publish a first list over an existing one.
 */
export const fetchServerListEvent = async (
  pubkey: string,
  options: ServerListOptions = {},
): Promise<NostrEvent | null> => {
  const events = await queryRelays(
    relaySet(options.indexers ?? INDEXER_RELAYS),
    { kinds: [BLOSSOM_SERVER_KIND], authors: [pubkey] },
    { ...options, timeoutMs: options.timeoutMs ?? SERVER_LIST_TIMEOUT_MS },
  ).catch(() => []);
  return newestEvent(events, pubkey, BLOSSOM_SERVER_KIND);
};

const cache = new Map<string, { expiresAt: number; servers: Promise<string[]> }>();

export const clearServerListCache = (): void => cache.clear();

/**
 * The other half, for drawing rather than for writing: a page finding a picture
 * gone asks where else it might be, and that answer keeps. Cached like a profile
 * and an author with no list included, since a page full of an author's
 * documents would otherwise ask once per broken avatar.
 */
export const fetchServerLists = async (
  pubkeys: string[],
  options: ServerListOptions = {},
): Promise<Map<string, string[]>> => {
  const now = Date.now();
  const wanted = [...new Set(pubkeys)];
  const missing = wanted.filter((pubkey) => (cache.get(pubkey)?.expiresAt ?? 0) <= now);

  if (missing.length > 0) {
    const pending = ask(missing, options);
    for (const pubkey of missing) {
      cache.set(pubkey, {
        expiresAt: now + SERVER_LIST_TTL_MS,
        servers: pending.then((lists) => lists.get(pubkey) ?? []),
      });
    }
  }

  const entries = await Promise.all(
    wanted.map(async (pubkey) => [pubkey, (await cache.get(pubkey)?.servers) ?? []] as const),
  );
  return new Map(entries);
};
