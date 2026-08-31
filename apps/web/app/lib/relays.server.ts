import { authorRelays, DEFAULT_RELAYS, relaySet, writeRelaysOf } from "@openspecs/nostr";
import { withDeadline } from "./cache.server";
import { PUBLIC_RELAYS } from "./relays";

/**
 * The author's own write relays come first: they are where their readers look.
 * The list is resolved on the server, where it is already cached, so the browser
 * is handed the addresses rather than the lookup.
 */
export const rebroadcastRelays = async (pubkey: string): Promise<string[]> =>
  relaySet(await writeRelaysOf([pubkey]), DEFAULT_RELAYS, PUBLIC_RELAYS);

/** Long enough for a lookup that is usually already cached, short enough not to be felt. */
const DEADLINE_MS = 1000;

/**
 * Both sides of the document author's NIP-65 list, resolved here rather than in
 * the browser. The package would resolve it itself and widen the subscription
 * once it had, but this server holds the same lookup cached across every request
 * and every reader, so handing over the addresses saves each of them a round
 * trip to an indexer and the pause before the conversation widens.
 *
 * Empty is a fine answer: the discussion opens on its own relays regardless, and
 * the browser resolves the list itself if this deadline passed first.
 */
export const discussionRelays = (pubkey: string): Promise<string[]> =>
  withDeadline(
    authorRelays(pubkey).catch(() => []),
    [],
    DEADLINE_MS,
  );
