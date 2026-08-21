import { type EventDraft, nostrEventSchema } from "./event";
import { CLIENT_NAME } from "./nip22";
import { queryRelays, type RelayOptions, relaySet } from "./pool";

export const RELAY_LIST_KIND = 10002;

/** Where a relay list is looked up, which is not where a document is read. */
export const INDEXER_RELAYS = [
  "wss://indexer.coracle.social",
  "wss://profiles.nostr1.com",
  "wss://relay.ditto.pub",
  "wss://relay.nmail.li",
];

/**
 * NIP-65 asks authors to keep a list small, 2 to 4 of each category, but nothing
 * enforces it and lists of a dozen relays are published. This bounds how many
 * sockets one page can open, and it is a real trade-off: a list is not ordered by
 * importance, so a document living only on the relays past this rank is missed.
 */
export const MAX_RELAYS_PER_AUTHOR = 4;

const RELAY_LIST_TIMEOUT_MS = 2000;
const RELAY_LIST_TTL_MS = 30 * 60 * 1000;

export type RelayList = {
  /** Where the author publishes. Only these hold the live revision of their documents. */
  write: string[];
  read: string[];
};

const EMPTY: RelayList = { write: [], read: [] };

export const parseRelayList = (input: unknown): RelayList | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== RELAY_LIST_KIND) return null;

  const write: string[] = [];
  const read: string[] = [];
  for (const tag of parsed.data.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const [url] = relaySet([tag[1]]);
    if (!url) continue;
    // An `r` tag with no marker is both, which is the majority case in the wild.
    const marker = tag[2];
    if (marker !== "read") write.push(url);
    if (marker !== "write") read.push(url);
  }
  return {
    write: write.slice(0, MAX_RELAYS_PER_AUTHOR),
    read: read.slice(0, MAX_RELAYS_PER_AUTHOR),
  };
};

/**
 * Every `r` tag unmarked, which is read as both read and write, above and by
 * everything else. A key publishing its first list has no reason to split the
 * two, and one whose list is read only is one whose documents nothing can find.
 *
 * How many is the caller's to decide, and `MAX_RELAYS_PER_AUTHOR` is what
 * survives being read back: naming a fifth relay names one nobody keeps.
 */
export const buildRelayList = (relays: string[]): EventDraft => ({
  kind: RELAY_LIST_KIND,
  content: "",
  tags: [...relaySet(relays).map((url) => ["r", url]), ["client", CLIENT_NAME]],
});

/** Indexers serve stale revisions of a relay list next to the live one, so the newest wins. */
export const selectRelayLists = (events: unknown[]): Map<string, RelayList> => {
  const newest = new Map<string, { createdAt: number; list: RelayList }>();
  for (const event of events) {
    const list = parseRelayList(event);
    const parsed = nostrEventSchema.safeParse(event);
    if (!list || !parsed.success) continue;
    const current = newest.get(parsed.data.pubkey);
    if (!current || parsed.data.created_at > current.createdAt) {
      newest.set(parsed.data.pubkey, { createdAt: parsed.data.created_at, list });
    }
  }
  return new Map([...newest].map(([pubkey, { list }]) => [pubkey, list]));
};

const cache = new Map<string, { expiresAt: number; list: Promise<RelayList> }>();

export const clearRelayListCache = (): void => cache.clear();

export type RelayListOptions = Omit<RelayOptions, "relays"> & { indexers?: string[] };

/**
 * Cached so that a page does not spend a round trip per author, the TTL bounding
 * how stale a list can get. An author with no list is cached too, otherwise every
 * page about them pays for the same lookup returning nothing.
 */
export const fetchRelayLists = async (
  pubkeys: string[],
  options: RelayListOptions = {},
): Promise<Map<string, RelayList>> => {
  const now = Date.now();
  const wanted = [...new Set(pubkeys)];
  const missing = wanted.filter((pubkey) => (cache.get(pubkey)?.expiresAt ?? 0) <= now);

  if (missing.length > 0) {
    const pending = queryRelays(
      relaySet(options.indexers ?? INDEXER_RELAYS),
      { kinds: [RELAY_LIST_KIND], authors: missing },
      { ...options, timeoutMs: options.timeoutMs ?? RELAY_LIST_TIMEOUT_MS },
    )
      .then(selectRelayLists)
      .catch(() => new Map<string, RelayList>());

    for (const pubkey of missing) {
      cache.set(pubkey, {
        expiresAt: now + RELAY_LIST_TTL_MS,
        list: pending.then((lists) => lists.get(pubkey) ?? EMPTY),
      });
    }
  }

  const entries = await Promise.all(
    wanted.map(async (pubkey) => [pubkey, (await cache.get(pubkey)?.list) ?? EMPTY] as const),
  );
  return new Map(entries);
};

export const fetchRelayList = async (
  pubkey: string,
  options: RelayListOptions = {},
): Promise<RelayList> => (await fetchRelayLists([pubkey], options)).get(pubkey) ?? EMPTY;

export const writeRelaysOf = async (
  pubkeys: string[],
  options: RelayListOptions = {},
): Promise<string[]> => {
  const lists = await fetchRelayLists(pubkeys, options);
  return relaySet([...lists.values()].flatMap((list) => list.write));
};
