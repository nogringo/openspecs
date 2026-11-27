import { createLoadCache, withDeadline } from "./cache.server";
import { compareSelected, fetchCandidates, type KnownCopies, selectCopies } from "./copies";
import { type CachedSpec, FRESH_MS, STALE_MS } from "./specs.server";

/** Long enough for an answer that is usually already cached, short enough not to be felt. */
const DEADLINE_MS = 1000;

/**
 * Keyed on the revision, since the margin marks are measured against its text.
 * Copies come and go like documents do, so they expire like documents too.
 */
const cache = createLoadCache<KnownCopies>({ max: 500, ttlMs: FRESH_MS, staleMs: STALE_MS });

const findCopies = ({ page, event }: CachedSpec): Promise<KnownCopies> =>
  cache.get(page.eventId, async () => {
    const candidates = await fetchCandidates(page);
    const copies = selectCopies(candidates, page);
    if (copies.length === 0) return { eventId: page.eventId, copies, spots: [], standings: {} };
    const { spots, standings } = compareSelected(candidates, copies, {
      content: event.content,
      title: page.title,
      npub: page.npub,
      identifier: page.identifier,
    });
    return { eventId: page.eventId, copies, spots, standings };
  });

/**
 * Who else has written this document and where their copies differ, so the page
 * arrives with them rather than growing them after paint. Null when the relays
 * took longer than the deadline: the browser asks them itself then, and the work
 * started here still fills the cache for the next reader.
 */
export const loadCopies = (cached: CachedSpec): Promise<KnownCopies | null> =>
  withDeadline(
    findCopies(cached).catch(() => null),
    null,
    DEADLINE_MS,
  );
