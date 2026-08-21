import type { Filter } from "nostr-tools/filter";
import type { SpecPointer } from "./address";
import { SPEC_KIND } from "./event";
import { type RelayListOptions, writeRelaysOf } from "./nip65";
import { queryRelays, type RelayOptions, relaySet } from "./pool";
import { parseSpec, type Spec } from "./spec";

/**
 * Where a document is looked for when its author has published no relay list.
 * The project's own relay comes first: the indexer will read straight from it,
 * so it is the one expected to hold the most specifications.
 */
export const DEFAULT_RELAYS = [
  "wss://relay.nmail.li",
  "wss://relay.ditto.pub",
  "wss://relay.dreamith.to",
  "wss://nos.lol",
  "wss://nostr.oxtr.dev",
];

/** Resolving relay lists for a whole listing would cost more than it can return. */
const MAX_OUTBOX_AUTHORS = 20;

export type FetchOptions = RelayOptions &
  RelayListOptions & {
    /** Set to false to read only from `relays`, ignoring the authors' NIP-65 lists. */
    outbox?: boolean;
  };

export type SpecQuery = {
  authors?: string[];
  identifiers?: string[];
  topics?: string[];
  /** Event kinds the document is about, matched on its `k` tags. */
  covers?: number[];
  since?: number;
  until?: number;
  limit?: number;
};

const coordinateOf = (spec: Spec): string => `${spec.pubkey}:${spec.identifier}`;

/**
 * Addressable events replace each other, so a coordinate has exactly one live
 * revision: the newest, with the lowest id breaking a tie (NIP-01). Relays keep
 * serving superseded revisions, so this cannot be skipped.
 */
export const latestByCoordinate = (specs: Spec[]): Spec[] => {
  const live = new Map<string, Spec>();
  for (const spec of specs) {
    const key = coordinateOf(spec);
    const current = live.get(key);
    if (
      !current ||
      spec.createdAt > current.createdAt ||
      (spec.createdAt === current.createdAt && spec.event.id < current.event.id)
    ) {
      live.set(key, spec);
    }
  }
  return [...live.values()];
};

const parseAll = (events: unknown[]): Spec[] =>
  events.map(parseSpec).filter((spec): spec is Spec => spec !== null);

/**
 * The authors' write relays are queried alongside the default ones rather than
 * after them: only the write relays are guaranteed to hold the live revision,
 * but a document is usually on both, and waiting on the relay list first would
 * put that lookup on the critical path of every server rendered page.
 */
const querySpecs = async (
  filter: Filter,
  authors: string[],
  options: FetchOptions,
  hints: string[] = [],
): Promise<Spec[]> => {
  const outbox =
    options.outbox === false || authors.length === 0 || authors.length > MAX_OUTBOX_AUTHORS
      ? Promise.resolve([])
      : writeRelaysOf(authors, options).then((relays) => queryRelays(relays, filter, options));

  const [fromDefaults, fromOutbox] = await Promise.all([
    queryRelays(relaySet(options.relays ?? DEFAULT_RELAYS, hints), filter, options),
    outbox,
  ]);
  return latestByCoordinate(parseAll([...fromDefaults, ...fromOutbox]));
};

export const fetchSpec = async (
  pointer: Pick<SpecPointer, "pubkey" | "identifier"> & { relays?: string[] },
  options: FetchOptions = {},
): Promise<Spec | null> => {
  const specs = await querySpecs(
    { kinds: [SPEC_KIND], authors: [pointer.pubkey], "#d": [pointer.identifier] },
    [pointer.pubkey],
    options,
    pointer.relays ?? [],
  );
  return specs[0] ?? null;
};

export const fetchSpecs = async (
  specQuery: SpecQuery = {},
  options: FetchOptions = {},
): Promise<Spec[]> => {
  const filter: Filter = { kinds: [SPEC_KIND] };
  if (specQuery.authors?.length) filter.authors = specQuery.authors;
  if (specQuery.identifiers?.length) filter["#d"] = specQuery.identifiers;
  if (specQuery.topics?.length) filter["#t"] = specQuery.topics;
  if (specQuery.covers?.length) filter["#k"] = specQuery.covers.map(String);
  if (specQuery.since !== undefined) filter.since = specQuery.since;
  if (specQuery.until !== undefined) filter.until = specQuery.until;
  if (specQuery.limit !== undefined) filter.limit = specQuery.limit;

  const specs = (await querySpecs(filter, specQuery.authors ?? [], options)).sort(
    (a, b) => b.publishedAt - a.publishedAt,
  );
  // The filter limit is per relay, so it only caps what comes in. The caller asked
  // for a number of documents, not a number of documents per operator.
  return specQuery.limit === undefined ? specs : specs.slice(0, specQuery.limit);
};
