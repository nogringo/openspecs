// The narrow entry point, not the package: this file ships to the browser with
// the page, and the package index would bring a relay client along with it.
import { stripInlineMarkdown } from "@openspecs/nostr/markdown";
import type { SpecCard } from "./specs.server";

/**
 * A listing row plus the document behind it. The body never reaches a loader's
 * payload, so this shape only ever exists in the browser, where the corpus is
 * downloaded and searched.
 */
export type SearchDoc = SpecCard & { content: string };

export type SearchHit = { doc: SearchDoc; score: number; excerpt: string };

const TITLE = 12;
const PHRASE = 8;
const IDENTIFIER = 8;
const TOPIC = 6;
const SUMMARY = 4;
/** A word repeated in a long document says less each time it is repeated. */
const BODY_CAP = 5;

const EXCERPT = 180;
const MAX_QUERY_TERMS = 12;

/**
 * Accents are a spelling, not a distinction: searching "reseau" must find
 * "réseau".
 *
 * Only the combining marks NFD produces are dropped, one per accented letter, so
 * the folded text lines up character for character with its source and a match
 * can be pointed at. `\p{Diacritic}` would be wrong here: it also covers the
 * ASCII backtick, tilde and caret, which a specification is full of.
 */
const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const searchTerms = (query: string): string[] => [
  ...new Set(
    fold(query)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term !== "")
      .slice(0, MAX_QUERY_TERMS),
  ),
];

export type Span = { at: number; length: number };

/**
 * Where the reader's words sit in a piece of text, so they can be marked.
 *
 * Matching runs on the folded text and the spans are handed back for the
 * original, since that is what gets rendered. Folding leaves Latin text the
 * length it was, but a script NFD decomposes further does not line up, so a span
 * is clamped to the text rather than trusted.
 */
export const matchSpans = (text: string, terms: string[]): Span[] => {
  if (terms.length === 0 || text === "") return [];
  const folded = fold(text);

  const found: Span[] = [];
  for (const term of terms) {
    let at = folded.indexOf(term);
    while (at !== -1) {
      if (at < text.length) found.push({ at, length: Math.min(term.length, text.length - at) });
      at = folded.indexOf(term, at + term.length);
    }
  }
  found.sort((left, right) => left.at - right.at);

  const merged: Span[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last && span.at <= last.at + last.length) {
      last.length = Math.max(last.length, span.at + span.length - last.at);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
};

const occurrences = (haystack: string, term: string): number => {
  let count = 0;
  let at = haystack.indexOf(term);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(term, at + term.length);
  }
  return count;
};

type Folded = { title: string; identifier: string; topics: string; summary: string; body: string };

/**
 * Folding the whole corpus costs more than matching against it, and the reader
 * types one letter at a time, so it is done once per document rather than once
 * per keystroke. The documents are the objects the corpus store holds, so this
 * empties on its own when they are replaced.
 */
const foldedDocs = new WeakMap<SearchDoc, Folded>();

const foldedOf = (doc: SearchDoc): Folded => {
  const known = foldedDocs.get(doc);
  if (known) return known;

  const folded: Folded = {
    title: fold(doc.title),
    identifier: fold(doc.identifier),
    topics: fold(doc.topics.join(" ")),
    summary: fold(doc.summary),
    body: fold(doc.content),
  };
  foldedDocs.set(doc, folded);
  return folded;
};

const scoreTerm = (folded: Folded, term: string): number => {
  const body = Math.min(occurrences(folded.body, term), BODY_CAP);
  const score =
    (folded.title.includes(term) ? TITLE : 0) +
    (folded.identifier.includes(term) ? IDENTIFIER : 0) +
    (folded.topics.includes(term) ? TOPIC : 0) +
    (folded.summary.includes(term) ? SUMMARY : 0) +
    body;
  return score;
};

/**
 * `stripInlineMarkdown` is written for a description, which is one paragraph, so
 * it leaves block syntax alone. An excerpt is a window cut wherever the word
 * fell, and it lands on headings and table rows as often as on prose.
 */
const withoutBlockMarkup = (text: string): string =>
  text
    .replace(/(^|\s)#{1,6}(?=\s)/g, "$1")
    .replace(/\|[\s|:-]*\|/g, " ")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    // A window cut inside a table ends on the half of a rule row that survived.
    .replace(/[-:\s]{3,}$/, "")
    .trim();

/**
 * Where the reader's word sits in the document, with enough around it to read.
 *
 * The window is cut out of the original body, so an excerpt keeps its accents
 * and its capitals, and the markup around it is stripped the same way a meta
 * description is. Stripping can swallow the word itself, when it only existed
 * inside a link target, and the raw window is shown rather than an excerpt that
 * does not contain what was searched for.
 */
const excerptFor = (doc: SearchDoc, folded: Folded, terms: string[]): string => {
  const term = terms.find((candidate) => folded.body.includes(candidate));
  if (term === undefined) return "";

  const at = folded.body.indexOf(term);
  const from = Math.max(0, at - Math.floor((EXCERPT - term.length) / 2));
  const cut = doc.content.slice(from, from + EXCERPT).replace(/^[#>\s`*_-]+/, "");

  const stripped = withoutBlockMarkup(stripInlineMarkdown(cut));
  const window = fold(stripped).includes(term) ? stripped : cut.replace(/\s+/g, " ").trim();
  if (window === "") return "";

  const head = from > 0 ? "..." : "";
  const tail = from + EXCERPT < doc.content.length ? "..." : "";
  return `${head}${window}${tail}`;
};

/**
 * Every term has to appear somewhere, in any field: a reader who types two words
 * is narrowing a search, not widening it. Ranking is what decides where the word
 * appearing in a title beats the same word buried in a body.
 */
export const searchDocs = (docs: SearchDoc[], query: string, limit?: number): SearchHit[] => {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const phrase = fold(query.trim());

  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const folded = foldedOf(doc);

    let score = 0;
    let matchesAll = true;
    for (const term of terms) {
      const termScore = scoreTerm(folded, term);
      if (termScore === 0) {
        matchesAll = false;
        break;
      }
      score += termScore;
    }
    if (!matchesAll) continue;

    if (terms.length > 1 && folded.title.includes(phrase)) score += PHRASE;
    hits.push({ doc, score, excerpt: excerptFor(doc, folded, terms) });
  }

  hits.sort((a, b) => b.score - a.score || b.doc.publishedAt - a.doc.publishedAt);
  return limit === undefined ? hits : hits.slice(0, limit);
};
