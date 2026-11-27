import {
  COMMENT_KIND,
  fetchDiscussionEvents,
  type NostrEvent,
  toCoordinate,
} from "@openspecs/nostr";
import { createLoadCache, withDeadline } from "./cache.server";
import type { KnownDiscussion } from "./discussion";
import { mentionedKeys } from "./mention";
import { loadAuthors } from "./profile.server";
import { FRESH_MS, STALE_MS } from "./specs.server";

/** Long enough for an answer that is usually already cached, short enough not to be felt. */
const DEADLINE_MS = 1000;
/** What is left of it for the names, which the browser can still fill in. */
const MIN_AUTHORS_MS = 200;

/**
 * Keyed on the revision, since its id is one of the things asked for. Served
 * stale while the relays are asked again behind it: the browser keeps the
 * conversation live from there, so a comment newer than this is a moment away.
 */
const cache = createLoadCache<NostrEvent[]>({ max: 500, ttlMs: FRESH_MS, staleMs: STALE_MS });

const keysOf = (events: NostrEvent[]): string[] => [
  ...new Set(
    events
      .filter((event) => event.kind === COMMENT_KIND)
      .flatMap((event) => [event.pubkey, ...mentionedKeys(event.content)]),
  ),
];

/**
 * The conversation about a document, read by this server's relay connections,
 * which are already open, rather than by the reader's, which are not. Null when
 * the relays took longer than the deadline: the browser asks them itself then,
 * and the work started here still fills the cache for the next reader.
 */
export const loadDiscussion = async (page: {
  pubkey: string;
  identifier: string;
  eventId: string;
}): Promise<KnownDiscussion | null> => {
  const started = Date.now();
  const coordinate = toCoordinate(page);
  const events = await withDeadline(
    cache
      .get(page.eventId, () => fetchDiscussionEvents({ coordinate, specEventId: page.eventId }))
      .catch(() => null),
    null,
    DEADLINE_MS,
  );
  if (events === null) return null;

  const left = Math.max(MIN_AUTHORS_MS, DEADLINE_MS - (Date.now() - started));
  const authors = await withDeadline(loadAuthors(keysOf(events)), {}, left);
  return { coordinate, events, authors };
};
