export type SpecsQuery = { topic?: string; kind?: string | number };

const withFilter = (base: string, query: SpecsQuery = {}): string => {
  const params = new URLSearchParams();
  if (query.topic) params.set("topic", query.topic);
  if (query.kind !== undefined && query.kind !== "") params.set("kind", String(query.kind));
  const search = params.toString();
  return search === "" ? base : `${base}?${search}`;
};

export const specsPath = (query: SpecsQuery = {}): string => withFilter("/specs", query);
export const rssPath = (query: SpecsQuery = {}): string => withFilter("/rss.xml", query);
export const atomPath = (query: SpecsQuery = {}): string => withFilter("/atom.xml", query);

export const listingTitle = (query: SpecsQuery = {}): string => {
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

/** Where a consumer asks what this site knows about one of its own pages. */
export const oembedPath = (canonical: string): string =>
  `/oembed?url=${encodeURIComponent(canonical)}`;
