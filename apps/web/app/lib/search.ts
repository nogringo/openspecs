// The narrow entry point, not the package: this file ships to the browser with
// the page, and the package index would bring a relay client along with it.
import { proseText } from "@openspecs/nostr/markdown";
import type { SpecCard } from "./specs.server";

/**
 * A listing row plus the document behind it. The body never reaches a loader's
 * payload, so this shape only exists where a corpus is held: on the server, which
 * searches it, and in the editor, which names kinds from it.
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

const WORD = /[\p{L}\p{N}]/u;

/**
 * Every place `term` starts a word, so "direct" is found in "directly" and never
 * in "redirect", and "dm" never in "admin". Stops at `cap`.
 */
const wordStarts = (folded: string, term: string, cap = Number.POSITIVE_INFINITY): number[] => {
  const found: number[] = [];
  let at = folded.indexOf(term);
  while (at !== -1 && found.length < cap) {
    if (at === 0 || !WORD.test(folded[at - 1] ?? "")) found.push(at);
    at = folded.indexOf(term, at + 1);
  }
  return found;
};

const hasWord = (folded: string, term: string): boolean => wordStarts(folded, term, 1).length > 0;

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
    for (const at of wordStarts(folded, term)) {
      if (at < text.length) found.push({ at, length: Math.min(term.length, text.length - at) });
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

type Folded = {
  title: string;
  identifier: string;
  topics: string;
  summary: string;
  body: string;
  /** The running text an excerpt is cut from, as written and folded. */
  prose: string;
  foldedProse: string;
};

/**
 * Folding the whole corpus costs more than matching against it, so it is done
 * once per document rather than once per search. The documents are the objects
 * the corpus holds, so this empties on its own when they are replaced.
 */
const foldedDocs = new WeakMap<SearchDoc, Folded>();

const foldedOf = (doc: SearchDoc): Folded => {
  const known = foldedDocs.get(doc);
  if (known) return known;

  const prose = proseText(doc.content);
  const folded: Folded = {
    title: fold(doc.title),
    identifier: fold(doc.identifier),
    topics: fold(doc.topics.join(" ")),
    summary: fold(doc.summary),
    body: fold(doc.content),
    prose,
    foldedProse: fold(prose),
  };
  foldedDocs.set(doc, folded);
  return folded;
};

const scoreTerm = (folded: Folded, term: string): number =>
  (hasWord(folded.title, term) ? TITLE : 0) +
  (hasWord(folded.identifier, term) ? IDENTIFIER : 0) +
  (hasWord(folded.topics, term) ? TOPIC : 0) +
  (hasWord(folded.summary, term) ? SUMMARY : 0) +
  wordStarts(folded.body, term, BODY_CAP).length;

const atWordEdge = (text: string, from: number, forward: boolean): number => {
  const space = forward ? text.indexOf(" ", from) : text.lastIndexOf(" ", from);
  return space === -1 ? from : forward ? space + 1 : space;
};

/**
 * Where the reader's words sit in the running text, with enough around it to
 * read: the whole phrase when the document has it, the first word otherwise.
 * Cut out of prose rather than out of the source, so a window can fall anywhere
 * without landing on a table rule or half a link. A word that only appears in
 * a heading, a code block or a link target has no excerpt, and the row shows its
 * summary instead.
 */
const excerptFor = (folded: Folded, terms: string[], phrase: string): string => {
  const { prose, foldedProse } = folded;
  const candidates = terms.length > 1 ? [phrase, ...terms] : terms;
  let at = -1;
  let length = 0;
  for (const candidate of candidates) {
    const [first] = wordStarts(foldedProse, candidate, 1);
    if (first !== undefined) {
      at = first;
      length = candidate.length;
      break;
    }
  }
  if (at === -1) return "";

  let from = Math.max(0, at - Math.floor((EXCERPT - length) / 2));
  let to = Math.min(prose.length, from + EXCERPT);
  if (from > 0) from = Math.min(atWordEdge(prose, from, true), at);
  if (to < prose.length) to = Math.max(atWordEdge(prose, to, false), at + length);

  const head = from > 0 ? "..." : "";
  const window = prose.slice(from, to).trim();
  return to < prose.length ? `${head}${window.replace(/[.,;:]+$/, "")}...` : `${head}${window}`;
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

    if (terms.length > 1 && hasWord(folded.title, phrase)) score += PHRASE;
    hits.push({ doc, score, excerpt: excerptFor(folded, terms, phrase) });
  }

  hits.sort((a, b) => b.score - a.score || b.doc.publishedAt - a.doc.publishedAt);
  return limit === undefined ? hits : hits.slice(0, limit);
};
