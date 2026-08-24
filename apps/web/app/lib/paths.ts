export type SpecsQuery = { topic?: string; kind?: string | number; q?: string; page?: number };

/** The first page is the listing itself, so it never carries a number of its own. */
const pageParam = (page: number | undefined): string | null =>
  page !== undefined && page > 1 ? String(page) : null;

const withFilter = (base: string, query: SpecsQuery = {}): string => {
  const params = new URLSearchParams();
  // First, because it is what the reader typed and the rest only narrows it.
  if (query.q) params.set("q", query.q);
  if (query.topic) params.set("topic", query.topic);
  if (query.kind !== undefined && query.kind !== "") params.set("kind", String(query.kind));
  // Last, since it narrows nothing: it only says where in the result you are.
  const page = pageParam(query.page);
  if (page !== null) params.set("page", page);
  const search = params.toString();
  return search === "" ? base : `${base}?${search}`;
};

export const specsPath = (query: SpecsQuery = {}): string => withFilter("/specs", query);

/** A feed cannot replay a search and has no pages, so neither reaches one. */
export type FeedQuery = Omit<SpecsQuery, "q" | "page">;
export const rssPath = (query: FeedQuery = {}): string => withFilter("/rss.xml", query);
export const atomPath = (query: FeedQuery = {}): string => withFilter("/atom.xml", query);

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
 * Further down one author's shelf. `authorPath` in the schema names the key, and
 * that address is not the place to say which page of it you are reading.
 */
export const authorPagePath = (npub: string, page?: number): string => {
  const value = pageParam(page);
  return value === null ? `/${npub}` : `/${npub}?page=${value}`;
};

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

/** What another key's document under the same name changes against this one. */
export const diffPath = (npub: string, identifier: string, otherNpub: string): string =>
  `/spec/${npub}/${encodeURIComponent(identifier)}/diff/${otherNpub}`;

/** A document nobody has written yet, which belongs to whichever key is connected. */
export const newSpecPath = (): string => "/new";

/**
 * Writing a document again, under the address it already has. `specPath` is
 * canonical and lives with the schema; this URL is this site's own, like the
 * event above it.
 */
export const specEditPath = (npub: string, identifier: string): string =>
  `/spec/${npub}/${encodeURIComponent(identifier)}/edit`;
