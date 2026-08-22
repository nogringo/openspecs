import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";
import { normalizeURL } from "nostr-tools/utils";
import type { NostrEvent } from "./event";

export const DEFAULT_TIMEOUT_MS = 4000;

let shared: SimplePool | null = null;

/** One pool for the whole process: the server keeps its relay connections warm between requests. */
export const relayPool = (): SimplePool => {
  shared ??= new SimplePool();
  return shared;
};

export const closeRelayPool = (): void => {
  shared?.destroy();
  shared = null;
};

export type RelayOptions = {
  relays?: string[];
  pool?: SimplePool;
  timeoutMs?: number;
};

/** Relay lists in the wild disagree on trailing slashes and case, which would double the connections. */
export const relaySet = (...lists: string[][]): string[] => {
  const urls = new Set<string>();
  for (const url of lists.flat()) {
    if (!/^wss?:\/\//i.test(url.trim())) continue;
    try {
      urls.add(normalizeURL(url.trim()));
    } catch {}
  }
  return [...urls];
};

/**
 * What somebody typed, read as a relay. `relaySet` above takes what a relay list
 * says, which is already a URL. This takes what a person types into a box, where
 * the scheme is the part nobody remembers and `https://` is what the browser bar
 * hands them when they copy the address of a relay's own page.
 */
export const relayUrl = (typed: string): string | null => {
  const value = typed.trim();
  if (value === "") return null;
  const url = /^wss?:\/\//i.test(value) ? value : `wss://${value.replace(/^https?:\/\//i, "")}`;
  return relaySet([url])[0] ?? null;
};

export const queryRelays = async (
  relays: string[],
  filter: Filter,
  options: RelayOptions = {},
): Promise<NostrEvent[]> => {
  if (relays.length === 0) return [];
  const pool = options.pool ?? relayPool();
  return pool.querySync(relays, filter, { maxWait: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
};
