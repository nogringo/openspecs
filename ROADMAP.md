# Roadmap

Built in order. SEO and link metadata come first, because they are the reason this
project exists. The database, the indexer and push notifications come last, because the
server rendering path does not need them: a loader can query relays directly from the
Node server with a short lived cache, which produces real HTML from day one.

## Lot 0, skeleton

- [x] pnpm monorepo, Biome, shared tsconfig, Vitest
- [x] React Router app in framework mode, Tailwind
- [x] Dockerfile, Compose, reverse proxy, deployed

## Lot 1, the event contract

- [x] `packages/nostr`: zod schemas for kind 30817, parsing, validation, naddr helpers
- [x] Relay reads: shared SimplePool, NIP-65 outbox, newest revision per coordinate
- [x] Tests against real kind 30817 event fixtures pulled from public relays

Testable without any UI. Everything downstream depends on it.

Read the existing schema, do not invent one. Where the UI needs something the schema does
not carry, derive it: the description comes from the first paragraph of the Markdown, not
from a `summary` tag, so it works on every document already published instead of only on
ours.

## Lot 2, SSR and SEO

- [x] Spec detail route: server loader querying relays, in memory LRU, `headers` with
      `s-maxage` and `stale-while-revalidate`
- [x] Server side Markdown rendering (remark, rehype, rehype-sanitize)
- [x] `meta` export: title, description, canonical, OpenGraph, Twitter card
- [x] JSON-LD `TechArticle`
- [x] Listing and home routes
- [x] npub canonical URLs, with NIP-05 and NIP-19 aliases redirecting 301

At the end of this lot, pasting a link into a chat renders a proper preview.

Do not set `clientLoader.hydrate = true` on content routes: it forces `HydrateFallback`
to render during SSR, which ships an empty skeleton to crawlers and defeats the point.

## Lot 3, link metadata

- [x] Dynamic OpenGraph images (satori, resvg) as a resource route, cached on disk
- [x] `sitemap.xml` and `robots.txt`
- [x] RSS and Atom feeds
- [x] oEmbed endpoint
- [x] Preview cards for external links cited inside specs
- [x] Author pages at the root, `/npub1...`, with their own card, feeds and
      sitemap entries, and every document linking to the key that signed it

Shippable here: read only, no accounts, no database, but properly indexed.

## Lot 4, identity and writing

- [x] NIP-07, NIP-46 and a key on this device, kept under a PIN when asked for
- [x] NIP-22 comments and replies, NIP-25 reactions with NIP-09 retraction
- [x] NIP-57 zaps, over WebLN, NIP-47 or an invoice the reader carries
- [ ] Editor, publishing kind 30817
- [ ] NIP-37 encrypted drafts
- [ ] Forks, NIP-32 approvals, NIP-84 highlights

## Lot 5, the backend

- [ ] Postgres, Drizzle, raw events stored as jsonb next to parsed projections
- [ ] Relay indexer, loaders reading from Postgres instead of relays
- [ ] Full revision history, read from the kind 1349 snapshots the crawler
      archives, so it is a projection of events rather than server only state
- [ ] Meilisearch
- [ ] Web Push
