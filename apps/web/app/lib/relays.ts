import {
  DEFAULT_RELAYS,
  DISCUSSION_RELAYS,
  fetchRelayLists,
  relaySet,
  writeRelaysOf,
} from "@openspecs/nostr";

/**
 * Relay hints found on the event being answered. Two, because a hint is a guess
 * somebody else made about where a thing lives.
 */
const MAX_HINTS = 2;

/**
 * A backstop, not a policy. Every input below is bounded at its source, NIP-65
 * lists to four relays each and hints to two, so the worst honest case is about
 * twenty. This only stops a malformed list from opening a hundred sockets, and
 * nothing that truncates a real case belongs here: cutting from the tail would
 * drop the relays this site and nostrhub read from, which is what decides
 * whether a comment is ever seen.
 */
export const MAX_WRITE_RELAYS = 32;

/** Where my own events go, so my own clients find what I wrote. */
export const outboxRelays = async (me: string): Promise<string[]> => {
  const mine = await writeRelaysOf([me]);
  // An author who published no list still has to be published somewhere.
  return mine.length > 0 ? mine : DEFAULT_RELAYS;
};

/** Where somebody is reached: their inbox, which is what NIP-65 calls read. */
export const inboxRelays = async (pubkeys: string[]): Promise<string[]> => {
  const lists = await fetchRelayLists(pubkeys.filter((pubkey) => pubkey !== ""));
  return relaySet([...lists.values()].flatMap((list) => list.read));
};

export type WriteTarget = {
  /**
   * Everyone this event is addressed to: the document's author always, and the
   * author of the comment being answered when there is one. They carry the `p`
   * and `P` tags, and their inboxes are where an event addressed to them goes.
   */
  addressed: string[];
  /** Relay hints carried by the event being answered. */
  hints?: string[];
  /** Their inbox, when a loader already resolved it. Saves a round trip. */
  inbox?: string[];
};

/**
 * Where a comment, a reply or a reaction is sent, in this order, since
 * `relaySet` dedupes while keeping the first place a relay was named:
 *
 * 1. my own write relays, or my events are missing from my own profile;
 * 2. the inboxes of everyone addressed, or the people being answered never see
 *    it, which is the whole of what NIP-65 is for;
 * 3. any relay hint on what is being answered;
 * 4. the relays this kind of client reads, `relay.ditto.pub` above all, because
 *    that is what decides whether nostrhub shows the comment;
 * 5. the relays this site reads, or the page that counts it cannot find it.
 *
 * `PUBLIC_RELAYS` is deliberately not here. It lives in `relays.server.ts` for
 * rebroadcasting a signed document, where no key is involved and every relay
 * checks the signature itself. Spraying a first-time key's reply across seven
 * large relays collects rate-limit refusals, and a row of red squares makes a
 * comment that worked look broken.
 */
export const writeRelays = async (me: string, target: WriteTarget): Promise<string[]> => {
  const [mine, theirs] = await Promise.all([
    outboxRelays(me),
    target.inbox === undefined ? inboxRelays(target.addressed) : Promise.resolve(target.inbox),
  ]);

  return relaySet(
    mine,
    theirs,
    (target.hints ?? []).slice(0, MAX_HINTS),
    DISCUSSION_RELAYS,
    DEFAULT_RELAYS,
  ).slice(0, MAX_WRITE_RELAYS);
};

/**
 * What goes in a zap request's `relays` tag, which is the one place a real cap
 * belongs: the whole request travels as a query parameter, and LNURL servers
 * have been seen to refuse or silently truncate an oversized one. The recipient
 * comes first, since a receipt they never see is a payment nobody thanks anyone
 * for, and this site's own relays are in it or the zap cannot be shown here.
 */
export const MAX_ZAP_RELAYS = 6;

export const zapReceiptRelays = async (me: string, recipient: string): Promise<string[]> => {
  const [theirs, mine] = await Promise.all([inboxRelays([recipient]), outboxRelays(me)]);
  return relaySet(theirs, mine, DISCUSSION_RELAYS, DEFAULT_RELAYS).slice(0, MAX_ZAP_RELAYS);
};
