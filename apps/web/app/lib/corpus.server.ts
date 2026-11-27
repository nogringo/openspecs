import {
  type Cursors,
  fetchProfiles,
  fetchRelayLists,
  latestByCoordinate,
  type Spec,
  type SyncOptions,
  type SyncResult,
  syncSpecs,
} from "@openspecs/nostr";

/** As often as a page is considered fresh, so what is read from here is never older than one. */
const REFRESH_MS = 60_000;

export type CorpusOptions = {
  sync?: (options: SyncOptions) => Promise<SyncResult>;
  /** What a page about these authors will ask for, asked before anyone opens one. */
  warm?: (authors: string[]) => void;
  refreshMs?: number;
};

const warmAuthors = (authors: string[]): void => {
  void fetchProfiles(authors);
  void fetchRelayLists(authors);
};

/** Matched the way a relay matches a tag filter: the value exactly as published. */
export const hasTag = (spec: Spec, name: string, value: string): boolean =>
  spec.event.tags.some((tag) => tag[0] === name && tag[1] === value);

/**
 * Every document the read relays hold, kept by this server so that a reader is
 * never the one who waits for them. It is read whole once, then asked only what
 * changed, and a document that drops off a relay stays here: nobody withdraws a
 * document by losing it, they do it by publishing a blank revision over it,
 * which is kept like any other.
 */
export const createCorpus = (options: CorpusOptions = {}) => {
  const sync = options.sync ?? syncSpecs;
  const warm = options.warm ?? warmAuthors;
  const live = new Map<string, Spec>();
  let cursors: Cursors = {};
  let read = false;
  let first: Promise<void> | null = null;
  let walking: Promise<void> | null = null;

  const keyOf = (pubkey: string, identifier: string) => `${pubkey}:${identifier}`;

  const keep = (specs: Spec[]): void => {
    for (const spec of specs) {
      const key = keyOf(spec.pubkey, spec.identifier);
      const current = live.get(key);
      const [newest] = latestByCoordinate(current === undefined ? [spec] : [current, spec]);
      if (newest !== undefined) live.set(key, newest);
    }
  };

  const walk = async (): Promise<void> => {
    const result = await sync({ cursors, onPage: keep });
    keep(result.specs);
    cursors = { ...cursors, ...result.cursors };
    read = true;
    warm([...new Set([...live.values()].map((spec) => spec.pubkey))]);
  };

  const tick = (): Promise<void> => {
    walking ??= walk()
      .catch(() => {})
      .finally(() => {
        walking = null;
      });
    return walking;
  };

  return {
    /**
     * Idempotent, and settles with the first walk only: a later one runs on a
     * timer, behind whoever is reading.
     */
    start: (): Promise<void> => {
      if (first !== null) return first;
      setInterval(() => void tick(), options.refreshMs ?? REFRESH_MS).unref();
      first = tick();
      return first;
    },
    /** As soon as a page of the first walk holds it, which is long before the walk ends. */
    spec: (pubkey: string, identifier: string): Spec | undefined =>
      live.get(keyOf(pubkey, identifier)),
    /**
     * Only once every relay has been read: before that a listing drawn from here
     * would pass for a short one.
     */
    specs: (): Spec[] | undefined => (read ? [...live.values()] : undefined),
  };
};

export const corpus = createCorpus();
