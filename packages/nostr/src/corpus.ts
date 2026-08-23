import type { Filter } from "nostr-tools/filter";
import { type NostrEvent, SPEC_KIND } from "./event";
import { queryRelays, type RelayOptions, relaySet } from "./pool";
import { latestByCoordinate, READ_RELAYS } from "./relay";
import { parseSpec, type Spec } from "./spec";

/** What is known about one relay since the last synchronisation. */
export type RelayCursor = {
  /** The newest `created_at` this relay has served. */
  newestAt: number;
  /** False when a guard rail stopped the walk before the relay ran out of events. */
  exhausted: boolean;
};

export type Cursors = Record<string, RelayCursor>;

export type SyncOptions = RelayOptions & {
  cursors?: Cursors;
  pageSize?: number;
  maxPages?: number;
  /** Ceiling per relay, so one talkative operator cannot hold the walk open forever. */
  maxEvents?: number;
  /** Called once per page, as it lands, so a caller can show results before the walk ends. */
  onPage?: (specs: Spec[]) => void;
};

/** Only what this run brought back: an incremental walk returns the new revisions, not the corpus. */
export type SyncResult = { specs: Spec[]; cursors: Cursors };

const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const MAX_EVENTS = 5000;

const parseAll = (events: unknown[]): Spec[] =>
  events.map(parseSpec).filter((spec): spec is Spec => spec !== null);

type RelaySync = { events: NostrEvent[]; cursor: RelayCursor };

/**
 * A relay answers a `limit` with whatever it feels like and never says it capped
 * the page, so the only way to read all of it is to walk backwards with `until`
 * until a page brings nothing new. A short page cannot end the walk: that is
 * exactly what a cap looks like from here.
 *
 * The walk is per relay because one shared cursor would be wrong: relays hold
 * different subsets, and moving `until` down to the deepest one skips everything
 * a denser relay had above its own floor.
 */
const syncRelay = async (relay: string, options: SyncOptions): Promise<RelaySync> => {
  const known = options.cursors?.[relay];
  const since = known?.exhausted && known.newestAt > 0 ? known.newestAt : undefined;
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const maxEvents = options.maxEvents ?? MAX_EVENTS;

  const seen = new Map<string, NostrEvent>();
  // Carried over, so a relay that answers nothing this time keeps the watermark
  // it earned last time instead of being read from the top again.
  let newestAt = known?.newestAt ?? 0;
  let until: number | undefined;
  let exhausted = false;

  for (let page = 0; page < maxPages; page++) {
    const filter: Filter = { kinds: [SPEC_KIND], limit: pageSize };
    if (since !== undefined) filter.since = since;
    if (until !== undefined) filter.until = until;

    const events = await queryRelays([relay], filter, options);
    const fresh = events.filter((event) => !seen.has(event.id));
    if (fresh.length === 0) {
      exhausted = true;
      break;
    }

    for (const event of fresh) {
      seen.set(event.id, event);
      if (event.created_at > newestAt) newestAt = event.created_at;
    }
    options.onPage?.(parseAll(fresh));

    // Inclusive, not `- 1`: two events sharing a timestamp across a page
    // boundary would be lost otherwise. The repeated page is absorbed by `seen`.
    until = Math.min(...events.map((event) => event.created_at));
    if (seen.size >= maxEvents) break;
  }

  return { events: [...seen.values()], cursor: { newestAt, exhausted } };
};

/**
 * Reads every specification the relays will hand over, page by page.
 *
 * A cursor from a previous run turns this into a delta: a relay that was read to
 * the end is only asked what it has learned since. One that was not is walked
 * again from the top, because the hole a guard rail left is on the old side and
 * no `since` can reach it.
 *
 * A relay that cannot be reached answers an empty page rather than an error, so
 * it keeps the watermark it had earned: that watermark was true when it was
 * written, and nothing is lost by trusting it once the relay answers again.
 */
export const syncSpecs = async (options: SyncOptions = {}): Promise<SyncResult> => {
  const relays = relaySet(options.relays ?? READ_RELAYS);
  const settled = await Promise.allSettled(relays.map((relay) => syncRelay(relay, options)));

  const events: NostrEvent[] = [];
  const cursors: Cursors = {};
  settled.forEach((result, index) => {
    const relay = relays[index];
    if (result.status !== "fulfilled" || relay === undefined) return;
    events.push(...result.value.events);
    cursors[relay] = result.value.cursor;
  });

  return { specs: latestByCoordinate(parseAll(events)), cursors };
};
