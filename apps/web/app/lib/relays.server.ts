import { DEFAULT_RELAYS, relaySet, writeRelaysOf } from "@openspecs/nostr";

/**
 * Where a rebroadcast goes, beyond the relays this project reads: large, open to
 * anyone's writes, and run by different operators. The point of rebroadcasting
 * is that no single operator decides whether a document survives.
 */
const PUBLIC_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://relay.snort.social",
  "wss://nostr-01.yakihonne.com",
];

/**
 * The author's own write relays come first: they are where their readers look.
 * The list is resolved on the server, where it is already cached, so the browser
 * is handed the addresses rather than the lookup.
 */
export const rebroadcastRelays = async (pubkey: string): Promise<string[]> =>
  relaySet(await writeRelaysOf([pubkey]), DEFAULT_RELAYS, PUBLIC_RELAYS);
