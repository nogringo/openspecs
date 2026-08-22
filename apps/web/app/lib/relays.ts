import {
  DEFAULT_RELAYS,
  DISCUSSION_RELAYS,
  fetchRelayLists,
  INDEXER_RELAYS,
  MAX_RELAYS_PER_AUTHOR,
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

/**
 * Where a document goes. Nobody is addressed by one, so unlike a comment there
 * is no inbox in this: the author's own write relays are where their readers
 * look, and `DEFAULT_RELAYS` is where this site's loader and the crawler read.
 * A document that reached only the first is one this site cannot render and no
 * mirror will ever copy.
 *
 * `PUBLIC_RELAYS` stays out, for the reason `writeRelays` gives below. Sending a
 * signed document on to more relays needs no key at all, which is what the
 * rebroadcast button on its own page is for.
 */
export const documentRelays = async (me: string): Promise<string[]> =>
  relaySet(await outboxRelays(me), DEFAULT_RELAYS).slice(0, MAX_WRITE_RELAYS);

/**
 * Where a key announces itself: its profile and its relay list. The indexers
 * first, because those two are read from there and nowhere else, then the
 * relays this site looks for documents on.
 *
 * Synchronous, and deliberately: a key made a second ago has no NIP-65 list to
 * look up, and `outboxRelays` asking for one would not merely spend a round trip
 * on nothing. It would cache the absence of a list under that key for half an
 * hour, so every comment written afterwards would ignore the list being
 * published here.
 *
 * `DISCUSSION_RELAYS` is left out. `writeRelays` already sends this reader's
 * first comment there, so their name travels with it, and a first run has
 * nothing to gain from three more squares.
 */
export const announceRelays = (): string[] => relaySet(INDEXER_RELAYS, DEFAULT_RELAYS);

/**
 * What a key made here names as its own. Four, because that is where readers
 * stop: NIP-65 asks for two to four of each, this project's own parser keeps the
 * first four, and a fifth would be a relay this key names and nobody reads.
 */
export const newKeyRelays = (): string[] =>
  relaySet(DEFAULT_RELAYS).slice(0, MAX_RELAYS_PER_AUTHOR);

/**
 * Where a key's own profile and relay list are read from and written back to.
 * The same set for both directions, deliberately: an edit that read from fewer
 * places than the last save wrote to would find nothing and offer to replace a
 * profile that exists with a blank one.
 *
 * `announceRelays` covers the indexers, which is where those two kinds are
 * aggregated, and the relays this site reads, which is where `MakeKey` sent them
 * minutes ago and no indexer may have them yet. The author's own list is added
 * for a key that publishes somewhere this site has never heard of.
 */
export const identityRelays = async (me: string): Promise<string[]> =>
  relaySet(announceRelays(), await outboxRelays(me)).slice(0, MAX_WRITE_RELAYS);

/**
 * The same, plus the list being published, so the relays a key has just named
 * hold the event that names them. Capped like any other write: this is the one
 * relay set with a length nobody but the reader decides.
 */
export const relayListRelays = async (me: string, chosen: string[]): Promise<string[]> =>
  relaySet(announceRelays(), await outboxRelays(me), chosen).slice(0, MAX_WRITE_RELAYS);

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
