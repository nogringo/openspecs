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
};

type Entry<T> = { value: Promise<T>; expiresAt: number };

/**
 * A load through cache holding promises rather than values, so ten requests
 * landing on the same cold document make one relay query instead of ten.
 * A rejected load is evicted, since caching a network failure for a minute
 * would turn a blip into an outage.
 */
export const createLoadCache = <T>(options: LoadCacheOptions<T>) => {
  const entries = new Map<string, Entry<T>>();

  const evictOldest = () => {
    if (entries.size <= options.max) return;
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  };

  return {
    get: (key: string, load: () => Promise<T>, now = Date.now()): Promise<T> => {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now) {
        // Insertion order is the recency list: re-inserting moves the key last.
        entries.delete(key);
        entries.set(key, cached);
        return cached.value;
      }

      const value = load();
      const entry: Entry<T> = { value, expiresAt: now + options.ttlMs };
      entries.delete(key);
      entries.set(key, entry);
      evictOldest();

      value.then(
        (resolved) => {
          if (entries.get(key) === entry && options.ttlMsFor) {
            entry.expiresAt = now + options.ttlMsFor(resolved);
          }
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );

      return value;
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
};
