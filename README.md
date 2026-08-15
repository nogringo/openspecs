# Open Specs

A place to write, publish and discover technical specifications, built on Nostr.

Any protocol, format or convention can be published here. Nostr is the identity and
storage layer, not the subject matter: documents are ordinary Nostr events, signed by
their author and stored on relays. No account is issued by this project and no content is
owned by it.

## Design principles

**Relays are the source of truth. The backend is an accelerator, never a dependency.**

The server renders pages, indexes content and serves search, but every document lives on
relays as a signed event. If this project's servers disappear, the client keeps working
against relays directly, and a fully static build of the same codebase can be hosted by
anyone.

Three rules follow from this, and they are load bearing:

1. **No server writes.** Every mutation is a Nostr event signed in the browser and
   published straight to relays. The backend only observes. There is no `action` export
   anywhere in the app.
2. **No server-only state.** Anything that matters (approvals, forks, status, revisions)
   must exist as a Nostr event. The database is a recomputable projection, never an
   origin.
3. **The backend is swappable.** Its URL is a user setting, and an empty value is valid
   and means relays only.

## SEO is a feature, not a finishing touch

The main gap Open Specs closes is discoverability. Pages are server rendered so that
crawlers and link unfurlers see real HTML, with per-document metadata, dynamic OpenGraph
images, JSON-LD, a sitemap and feeds.

Canonical URLs are built on npub rather than NIP-05, because an npub is the identity
itself: it cannot expire and cannot be reassigned by a domain owner.

```
/spec/npub1.../custom-xyz-events      canonical
/spec/alice@example.com/custom-xyz-events   301 to the canonical form
/naddr1...                             301 to the canonical form
```

## Event schema

A specification is an addressable event of kind `30817`, holding Markdown in `content`,
identified by its `d` tag. Discussion, curation and annotation reuse standard NIPs rather
than inventing anything: NIP-22 comments, NIP-32 labels, NIP-84 highlights and NIP-37
encrypted drafts.

Nothing in the schema is Nostr specific. A spec about Nostr declares the event kinds it
covers with `k` tags; a spec about anything else simply omits them. Both are ordinary
events, and any client can read either.

This schema is read as it already exists rather than redefined here. Anything the
interface needs that the schema does not carry is derived from the document itself
instead of being mandated as a new tag.

## Stack

React Router (framework mode) for SSR, TypeScript, Tailwind. Postgres, Meilisearch and a
relay indexer arrive later, behind a `SpecSource` interface that the routes are written
against, so the same route code runs with or without a backend.

## Development

```sh
pnpm install
pnpm dev
```

| Command            | Description                        |
| ------------------ | ---------------------------------- |
| `pnpm dev`         | Dev server with HMR                |
| `pnpm build`       | Production build                   |
| `pnpm start`       | Serve the production build         |
| `pnpm typecheck`   | Type check every workspace package |
| `pnpm test`        | Run tests                          |
| `pnpm lint`        | Lint and format check              |
| `pnpm format`      | Apply lint and format fixes        |

## Layout

```
apps/web        React Router app, SSR and static builds
packages/       shared contracts and implementations (from lot 1 on)
infra/          Docker Compose, reverse proxy
```

See `ROADMAP.md` for what is built and in which order.
