/**
 * How long a page waits on something it does not control. The work it started
 * keeps going and fills the cache, so what is missing here is there on the next
 * request, and the reader never waits on the same slow third party twice.
 */
export const withDeadline = <T>(work: Promise<T>, fallback: T, ms: number): Promise<T> =>
  Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms).unref();
    }),
  ]);

export type LoadCacheOptions<T> = {
  /** Entries kept before the least recently used one is dropped. */
  max: number;
  ttlMs: number;
  /** Lets a result expire sooner than the rest, a miss for instance. */
  ttlMsFor?: (value: T) => number;
  /**
   * How long an expired result is still served while a fresh one loads behind
   * it, so nobody waits on a key that was loaded before. None by default.
   */
  staleMs?: number;
  /** Lets a result be served stale for less long than the rest, or not at all. */
  staleMsFor?: (value: T) => number;
};

type Entry<T> = {
  value: Promise<T>;
  expiresAt: number;
  /** Zero until the value resolves: a load still running has nothing stale to give. */
  staleUntil: number;
  refreshing: boolean;
};

/**
 * A load through cache holding promises rather than values, so ten requests
 * landing on the same cold document make one relay query instead of ten.
 * A rejected load is evicted, since caching a network failure for a minute
 * would turn a blip into an outage. A rejected refresh is not: the stale value
 * stays, and the next request tries again.
 */
export const createLoadCache = <T>(options: LoadCacheOptions<T>) => {
  const entries = new Map<string, Entry<T>>();

  const evictOldest = () => {
    if (entries.size <= options.max) return;
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  };

  // Insertion order is the recency list: re-inserting moves the key last.
  const touch = (key: string, entry: Entry<T>) => {
    entries.delete(key);
    entries.set(key, entry);
  };

  const start = (key: string, load: () => Promise<T>, now: number): Entry<T> => {
    const entry: Entry<T> = {
      value: load(),
      expiresAt: now + options.ttlMs,
      staleUntil: 0,
      refreshing: false,
    };
    entry.value.then(
      (resolved) => {
        entry.expiresAt = now + (options.ttlMsFor?.(resolved) ?? options.ttlMs);
        entry.staleUntil =
          entry.expiresAt + (options.staleMsFor?.(resolved) ?? options.staleMs ?? 0);
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    return entry;
  };

  const refresh = (key: string, stale: Entry<T>, load: () => Promise<T>, now: number) => {
    stale.refreshing = true;
    const fresh = start(key, load, now);
    fresh.value.then(
      () => {
        if (entries.get(key) === stale) entries.set(key, fresh);
      },
      () => {
        stale.refreshing = false;
      },
    );
  };

  return {
    get: (key: string, load: () => Promise<T>, now = Date.now()): Promise<T> => {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now) {
        touch(key, cached);
        return cached.value;
      }
      if (cached && cached.staleUntil > now) {
        touch(key, cached);
        if (!cached.refreshing) refresh(key, cached, load, now);
        return cached.value;
      }

      const entry = start(key, load, now);
      touch(key, entry);
      evictOldest();
      return entry.value;
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
};
