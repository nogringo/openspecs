import { type EventDraft, type NostrEvent, newestEvent, nostrEventSchema } from "./event";
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

export type RelayEntry = {
  url: string;
  /** Absent is what an unmarked `r` tag means: both, and the majority case in the wild. */
  marker?: "read" | "write";
};

/**
 * Every relay an author named, in the order they named them and with their
 * markers intact. `parseRelayList` above reads somebody else's list and cuts it
 * to what this client will open; this is for an author reading back their own to
 * edit it, where a relay dropped on the way in is a relay deleted on the way out.
 */
export const parseRelayEntries = (input: unknown): RelayEntry[] | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== RELAY_LIST_KIND) return null;

  const entries: RelayEntry[] = [];
  const seen = new Set<string>();
  for (const tag of parsed.data.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const [url] = relaySet([tag[1]]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const marker = tag[2];
    entries.push(marker === "read" || marker === "write" ? { url, marker } : { url });
  }
  return entries;
};

/**
 * A bare URL is written unmarked, which is read as both read and write, above
 * and by everything else. A key publishing its first list has no reason to split
 * the two, and one whose list is read only is one whose documents nothing can
 * find. An entry keeps whatever marker it arrived with, so a list edited here
 * comes back out of a form that never showed markers with its own intact.
 *
 * How many is the caller's to decide, and `MAX_RELAYS_PER_AUTHOR` is what
 * survives being read back: naming a fifth relay names one nobody keeps.
 */
export const buildRelayList = (relays: Array<string | RelayEntry>): EventDraft => {
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const relay of relays) {
    const entry = typeof relay === "string" ? { url: relay, marker: undefined } : relay;
    const [url] = relaySet([entry.url]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    tags.push(entry.marker === undefined ? ["r", url] : ["r", url, entry.marker]);
  }
  return { kind: RELAY_LIST_KIND, content: "", tags: [...tags, ["client", CLIENT_NAME]] };
};

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

/**
 * The live kind 10002, whole and unparsed, for an author about to write one
 * back. Uncached and uncapped, for the reasons `fetchProfileEvent` and
 * `parseRelayEntries` give: half an hour is long enough to republish a list the
 * author has since changed elsewhere, and four is fewer than some of them name.
 */
export const fetchRelayListEvent = async (
  pubkey: string,
  options: RelayListOptions = {},
): Promise<NostrEvent | null> => {
  const events = await queryRelays(
    relaySet(options.indexers ?? INDEXER_RELAYS),
    { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
    { ...options, timeoutMs: options.timeoutMs ?? RELAY_LIST_TIMEOUT_MS },
  ).catch(() => []);
  return newestEvent(events, pubkey, RELAY_LIST_KIND);
};

export const writeRelaysOf = async (
  pubkeys: string[],
  options: RelayListOptions = {},
): Promise<string[]> => {
  const lists = await fetchRelayLists(pubkeys, options);
  return relaySet([...lists.values()].flatMap((list) => list.write));
};
