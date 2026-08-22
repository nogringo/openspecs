export type SpecsQuery = { topic?: string; kind?: string | number; q?: string };

const withFilter = (base: string, query: SpecsQuery = {}): string => {
  const params = new URLSearchParams();
  // First, because it is what the reader typed and the rest only narrows it.
  if (query.q) params.set("q", query.q);
  if (query.topic) params.set("topic", query.topic);
  if (query.kind !== undefined && query.kind !== "") params.set("kind", String(query.kind));
  const search = params.toString();
  return search === "" ? base : `${base}?${search}`;
};

export const specsPath = (query: SpecsQuery = {}): string => withFilter("/specs", query);

/** A feed cannot replay a search, so `q` never reaches one. */
export const rssPath = (query: Omit<SpecsQuery, "q"> = {}): string => withFilter("/rss.xml", query);
export const atomPath = (query: Omit<SpecsQuery, "q"> = {}): string =>
  withFilter("/atom.xml", query);

export const listingTitle = (query: SpecsQuery = {}): string => {
  if (query.q) return `Search results for "${query.q}"`;
  if (query.topic) return `Specifications about #${query.topic}`;
  if (query.kind !== undefined && query.kind !== "")
    return `Specifications covering kind ${query.kind}`;
  return "All specifications";
};

export const listingDescription = (query: SpecsQuery = {}): string =>
  `${listingTitle(query)}, published as signed Nostr events and readable by anyone.`;

/** A feed is named after the site, since that is what a reader subscribes to. */
export const feedTitle = (query: SpecsQuery = {}): string => {
  if (query.topic) return `Open Specs, #${query.topic}`;
  if (query.kind !== undefined && query.kind !== "") return `Open Specs, kind ${query.kind}`;
  return "Open Specs";
};

/** The card an unfurler reads, drawn from the document it addresses. */
export const ogImagePath = (npub: string, identifier: string): string =>
  `/og/${npub}/${encodeURIComponent(identifier)}`;

/** The same, for an author, drawn from their profile and their shelf. */
export const authorOgImagePath = (npub: string): string => `/og/${npub}`;

/**
 * An author's feeds hang under the author, not under the listing: what a reader
 * subscribes to here is a person, and a person is not a query.
 */
export const authorRssPath = (npub: string): string => `/${npub}/rss.xml`;
export const authorAtomPath = (npub: string): string => `/${npub}/atom.xml`;

/** Where a consumer asks what this site knows about one of its own pages. */
export const oembedPath = (canonical: string): string =>
  `/oembed?url=${encodeURIComponent(canonical)}`;

/** The signed event behind a document, served as it came off the relays. */
export const eventPath = (npub: string, identifier: string): string =>
  `/spec/${npub}/${encodeURIComponent(identifier)}/event.json`;

/** A document nobody has written yet, which belongs to whichever key is connected. */
export const newSpecPath = (): string => "/new";

/**
 * Writing a document again, under the address it already has. `specPath` is
 * canonical and lives with the schema; this URL is this site's own, like the
 * event above it.
 */
export const specEditPath = (npub: string, identifier: string): string =>
  `/spec/${npub}/${encodeURIComponent(identifier)}/edit`;
