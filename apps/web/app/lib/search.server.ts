import type { Spec } from "@openspecs/nostr";
import { withDeadline } from "./cache.server";
import { corpus } from "./corpus.server";
import { pageOf } from "./pagination";
import { type SearchDoc, searchDocs } from "./search";
import { type SpecCard, toCard } from "./specs.server";
import { topicsByFrequency } from "./topics";

/** Only the first walk after a restart is ever waited on, and never for long. */
const FIRST_WALK_MS = 5000;
/** The best results, whose topics are worth narrowing to, rather than every loose match. */
const TOPICS_FROM = 20;

/** What a result row needs: the listing card, and the words found around the query. */
export type SearchRow = SpecCard & { excerpt: string };

export type SearchPage = {
  rows: SearchRow[];
  /** Every hit, not only the ones on this page. */
  results: number;
  /** How many documents the query was asked of, once the topic and the kind had narrowed them. */
  documents: number;
  /** The topics of the best of what was found, to narrow it further. */
  topics: string[];
  page: number;
  pages: number;
  /** True only in the seconds after a restart, before the corpus has been read once. */
  reading: boolean;
};

export type SearchQuery = {
  query: string;
  topic?: string;
  kind?: number;
  page: number;
  pageSize: number;
  topicsShown: number;
};

/**
 * Built once per revision, so the folding `searchDocs` caches against the
 * document is kept from one search to the next.
 */
const docs = new WeakMap<Spec, SearchDoc>();
const cards = new WeakMap<SearchDoc, SpecCard>();

const docOf = (spec: Spec): SearchDoc => {
  const known = docs.get(spec);
  if (known !== undefined) return known;
  const card = toCard(spec);
  const doc = { ...card, content: spec.content };
  docs.set(spec, doc);
  cards.set(doc, card);
  return doc;
};

/**
 * The corpus this server holds, searched here so the results are in the page
 * that answers the query. Only the shown page leaves, and without the bodies.
 */
export const searchSpecs = async (search: SearchQuery): Promise<SearchPage> => {
  await withDeadline(corpus.start(), undefined, FIRST_WALK_MS);
  const held = corpus.specs();
  if (held === undefined) {
    return { rows: [], results: 0, documents: 0, topics: [], page: 1, pages: 1, reading: true };
  }

  const scoped = held
    .filter(
      (spec) =>
        !spec.isEmpty &&
        (search.topic === undefined || spec.topics.includes(search.topic)) &&
        (search.kind === undefined || spec.kinds.some((ref) => ref.kind === search.kind)),
    )
    .map(docOf);
  const hits = searchDocs(scoped, search.query);
  const { items, page, pages } = pageOf(hits, search.page, search.pageSize);

  return {
    rows: items.map((hit) => ({ ...(cards.get(hit.doc) ?? hit.doc), excerpt: hit.excerpt })),
    results: hits.length,
    documents: scoped.length,
    topics: topicsByFrequency(
      hits.slice(0, TOPICS_FROM).map((hit) => hit.doc),
      search.topicsShown,
    ),
    page,
    pages,
    reading: false,
  };
};
