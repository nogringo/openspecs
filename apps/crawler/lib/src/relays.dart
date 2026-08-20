/// Kind of an OpenSpecs document. Same value as `SPEC_KIND` in `packages/nostr`.
const specKind = 30817;

/// Where documents are read from, mirroring `DEFAULT_RELAYS` in
/// `packages/nostr`: the relays the web app itself queries, so the crawler sees
/// what a reader sees.
const sourceRelays = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://nos.lol',
  'wss://nostr.oxtr.dev',
  'wss://theforest.nostr1.com',
];

/// Where documents are copied to: large, open to anyone's writes, and run by
/// different operators, so no single one decides whether a document survives.
/// A relay only earns a place here if it speaks NIP-77, otherwise the crawler
/// would have to blind push its whole corpus on every run.
const mirrorRelays = ['wss://relay.nmail.li'];
