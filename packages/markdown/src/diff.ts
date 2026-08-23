import { diffArrays } from "diff";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { type MentionResolver, renderMarkdown } from "./render";

export type MarkdownDiff = {
  /** The base document rendered whole, with the other one's differences marked in place. */
  html: string;
  /** Words the two documents share over words they hold, 0 to 1. */
  similarity: number;
  changed: boolean;
};

export type MarkdownDiffOptions = {
  mention?: MentionResolver;
};

/**
 * Below this, two blocks paired by position are not two drafts of one passage
 * but two passages, and marking every word of both says less than showing them
 * whole, one struck and one added.
 */
const MERGE_FLOOR = 0.4;

/** Past this, pairing every removed block against every added one costs more than it places. */
const PAIRING_CAP = 400;

const parser = unified().use(remarkParse).use(remarkGfm);

type Blocks = { blocks: string[]; hasTitle: boolean };

/**
 * The document cut where its author cut it: one source block per top level
 * node, so a fenced code block or a table moves through the diff whole.
 */
const blocksOf = (content: string): Blocks => {
  const tree = parser.parse(content);
  const blocks: string[] = [];
  let hasTitle = false;
  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 1) hasTitle = true;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const block = content.slice(start, end);
    if (block.trim() !== "") blocks.push(block);
  }
  return { blocks, hasTitle };
};

const normalize = (block: string): string => block.replace(/\s+/g, " ").trim();

const words = (content: string): string[] => content.split(/\s+/).filter((word) => word !== "");

/** Word level, on the sources: what the diff view is gated and reported on. */
export const textSimilarity = (base: string, other: string): number => {
  const a = words(base);
  const b = words(other);
  if (a.length === 0 && b.length === 0) return 1;
  let common = 0;
  for (const part of diffArrays(a, b)) {
    if (!part.added && !part.removed) common += part.value.length;
  }
  return (2 * common) / (a.length + b.length);
};

/**
 * A tag stripped to its name, so a heading whose text changed still meets its
 * counterpart: their `id` attributes differ, and comparing tags whole would
 * emit both open tags into a document that closes only one of them.
 */
const tagKey = (token: string): string =>
  token.startsWith("<") ? `${token.match(/^<\/?[a-zA-Z0-9-]+/)?.[0] ?? token}>` : token;

const TOKEN = /<[^>]+>|&[a-zA-Z0-9#]+;|\s+|[^\s<&]+|&/g;

const tokenize = (html: string): string[] => html.match(TOKEN) ?? [];

const isTag = (token: string): boolean => token.startsWith("<");

/**
 * Text wrapped, tags passed through: a mark around a word is the point, and a
 * mark around a `</p>` is broken markup. A run of pure whitespace goes bare,
 * since an empty highlight is a smudge.
 */
const wrapRun = (tokens: string[], mark: "ins" | "del"): string => {
  let out = "";
  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const text = run.join("");
    out += text.trim() === "" ? text : `<${mark}>${text}</${mark}>`;
    run = [];
  };
  for (const token of tokens) {
    if (isTag(token)) {
      flush();
      out += token;
    } else {
      run.push(token);
    }
  }
  flush();
  return out;
};

/**
 * Two renderings of one passage, merged into one with the differences marked.
 * Where they agree the other side's tokens are kept, so an id or an href that
 * moved with the text is the one the marks sit in.
 */
const mergeFragments = (base: string, other: string): string => {
  const a = tokenize(base);
  const b = tokenize(other);
  let ia = 0;
  let ib = 0;
  let out = "";
  for (const part of diffArrays(a.map(tagKey), b.map(tagKey))) {
    const count = part.value.length;
    if (part.removed) {
      out += wrapRun(a.slice(ia, ia + count), "del");
      ia += count;
    } else if (part.added) {
      out += wrapRun(b.slice(ib, ib + count), "ins");
      ib += count;
    } else {
      out += b.slice(ib, ib + count).join("");
      ia += count;
      ib += count;
    }
  }
  return out;
};

type Op =
  | { type: "same"; block: string }
  | { type: "del"; block: string }
  | { type: "ins"; block: string }
  | { type: "replace"; base: string; other: string };

/**
 * A replaced run holds the base's blocks and the other's, and nothing says the
 * first of one is a draft of the first of the other. Each pair close enough to
 * merge is merged; what pairs with nothing is shown whole. Greedy on the best
 * scores, which is as much cleverness as a run of a few blocks can repay.
 */
const pairReplaced = (removed: string[], added: string[]): Op[] => {
  if (removed.length * added.length > PAIRING_CAP) {
    const paired = Math.min(removed.length, added.length);
    return [
      ...removed.slice(0, paired).map((block, i): Op => {
        const other = added[i] as string;
        return { type: "replace", base: block, other };
      }),
      ...removed.slice(paired).map((block): Op => ({ type: "del", block })),
      ...added.slice(paired).map((block): Op => ({ type: "ins", block })),
    ];
  }

  const scores: { i: number; j: number; score: number }[] = [];
  removed.forEach((base, i) => {
    added.forEach((other, j) => {
      const score = textSimilarity(base, other);
      if (score >= MERGE_FLOOR) scores.push({ i, j, score });
    });
  });
  scores.sort((a, b) => b.score - a.score);

  const baseOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const { i, j } of scores) {
    if (baseOf.has(j) || taken.has(i)) continue;
    baseOf.set(j, i);
    taken.add(i);
  }

  // The other document's order carries the run, its unmatched partner leads it:
  // what only the base held reads first as struck, then the run as it now stands.
  const ops: Op[] = removed
    .filter((_, i) => !taken.has(i))
    .map((block): Op => ({ type: "del", block }));
  added.forEach((block, j) => {
    const i = baseOf.get(j);
    ops.push(
      i === undefined
        ? { type: "ins", block }
        : { type: "replace", base: removed[i] as string, other: block },
    );
  });
  return ops;
};

const planOps = (baseBlocks: string[], otherBlocks: string[]): Op[] => {
  const parts = diffArrays(baseBlocks.map(normalize), otherBlocks.map(normalize));
  const ops: Op[] = [];
  let ia = 0;
  let ib = 0;
  for (let at = 0; at < parts.length; at++) {
    const part = parts[at];
    if (part === undefined) continue;
    const count = part.value.length;
    if (part.removed) {
      const next = parts[at + 1];
      const removed = baseBlocks.slice(ia, ia + count);
      ia += count;
      if (next?.added) {
        const added = otherBlocks.slice(ib, ib + next.value.length);
        ib += next.value.length;
        at++;
        ops.push(...pairReplaced(removed, added));
      } else {
        ops.push(...removed.map((block): Op => ({ type: "del", block })));
      }
    } else if (part.added) {
      ops.push(...otherBlocks.slice(ib, ib + count).map((block): Op => ({ type: "ins", block })));
      ib += count;
    } else {
      ops.push(...baseBlocks.slice(ia, ia + count).map((block): Op => ({ type: "same", block })));
      ia += count;
      ib += count;
    }
  }
  return ops;
};

/**
 * The base document whole, with what the other one changes marked in place:
 * `ins` and `del` through a reworked passage, and a whole block the other adds
 * or lacks wrapped in `diff-ins` or `diff-del`. The merge happens on rendered
 * fragments rather than on the sources, so a mark can never break the syntax
 * it sits in, and everything shown passed through the same sanitizer as a page.
 */
export const diffMarkdown = (
  base: string,
  other: string,
  options: MarkdownDiffOptions = {},
): MarkdownDiff => {
  const from = blocksOf(base);
  const to = blocksOf(other);
  // The same offset for both sides, or two copies of one heading would render
  // at two depths and read as a change.
  const headingOffset = from.hasTitle || to.hasTitle ? 1 : 0;
  const render = (block: string): string =>
    renderMarkdown(block, { headingOffset, mention: options.mention }).html;

  const renderOp = (op: Op): string => {
    if (op.type === "replace") return mergeFragments(render(op.base), render(op.other));
    if (op.type === "same") return render(op.block);
    return `<div class="diff-${op.type}">${render(op.block)}</div>`;
  };

  const ops = planOps(from.blocks, to.blocks);
  const html = ops.map(renderOp).join("\n");

  return {
    html,
    similarity: textSimilarity(base, other),
    changed: ops.some((op) => op.type !== "same"),
  };
};
