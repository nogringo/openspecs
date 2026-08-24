import type { Filter } from "nostr-tools/filter";
import type { NostrEvent } from "./event";
import { type RelayOptions, relayPool } from "./pool";

/** A filter with a thousand ids in it is refused by relays that bound their inputs. */
export const MAX_IDS_PER_FILTER = 200;

/** Values chunked into filters a relay will accept, in the order they were given. */
export const inChunks = <T>(values: T[], size = MAX_IDS_PER_FILTER): T[][] => {
  const unique = [...new Set(values)];
  const chunks: T[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
};

export type Subscription = { close: () => void };

export type WideningSubscription = Subscription & {
  /** Adds relays to a subscription already running, unless it has been closed. */
  widen: (relays: string[], quiet: boolean) => void;
};

export const without = (relays: string[], already: string[]): string[] =>
  relays.filter((relay) => !already.includes(relay));

/**
 * A subscription that can be told about more relays after it is running.
 *
 * Every reader here starts on the relays it already knows and learns about
 * better ones a round trip later, from a NIP-65 list. Waiting for that list
 * before subscribing would put a lookup on the critical path of something that
 * should already be on screen, and the relays added afterwards send what they
 * hold the moment they are asked, so nothing is lost by adding them late.
 */
export const openWidening = (
  relays: string[],
  filters: Filter[],
  onEvent: (event: NostrEvent) => void,
  options: RelayOptions & { onEose?: () => void } = {},
): WideningSubscription => {
  const pool = options.pool ?? relayPool();
  const closers: { close: () => void }[] = [];
  let closed = false;

  const subscribe = (to: string[], onEose: (() => void) | undefined) => {
    if (closed || to.length === 0) return;
    for (const filter of filters) {
      closers.push(
        pool.subscribe(to, filter, {
          onevent: (event) => onEvent(event as NostrEvent),
          oneose: onEose,
        }),
      );
    }
  };

  subscribe(relays, options.onEose);

  return {
    // The widening relays do not report an end of stored events: the caller was
    // told what it asked for had arrived once already, and saying so again would
    // put a page that has finished loading back into loading.
    widen: (more, quiet) => subscribe(more, quiet ? undefined : options.onEose),
    close: () => {
      closed = true;
      for (const closer of closers) closer.close();
    },
  };
};
