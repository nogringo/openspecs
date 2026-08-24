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
 * Below this, two documents share a name but not a text, and marking their
 * differences would mark nearly everything. Callers use it to decide whether a
 * comparison is worth showing at all. The NIP forks in the wild sit near 0.9,
 * an honest rewrite near 0.2.
 */
export const KINSHIP_FLOOR = 0.35;

/**
 * Below this, two blocks paired by position are not two drafts of one passage
 * but two passages, and marking every word of both says less than showing them
 * whole, one struck and one added.
 */
const MERGE_FLOOR = 0.4;

/** Past this, pairing every removed block against every added one costs more than it places. */
const PAIRING_CAP = 400;

const parser = unified().use(remarkParse).use(remarkGfm);

type ParsedBlock = { type: string; depth: number; source: string };

/**
 * The document cut where its author cut it: one source block per top level
 * node, so a fenced code block or a table moves through the diff whole. Every
 * consumer of block indices goes through this one cut, or their indices would
 * name different blocks.
 */
const parsedBlocks = (content: string): ParsedBlock[] => {
  const tree = parser.parse(content);
  const blocks: ParsedBlock[] = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const source = content.slice(start, end);
    if (source.trim() === "") continue;
    blocks.push({
      type: node.type,
      depth: node.type === "heading" ? node.depth : 0,
      source,
    });
  }
  return blocks;
};

type Blocks = { blocks: string[]; hasTitle: boolean };

const blocksOf = (content: string): Blocks => {
  const parsed = parsedBlocks(content);
  return {
    blocks: parsed.map((block) => block.source),
    hasTitle: parsed.some((block) => block.type === "heading" && block.depth === 1),
  };
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

/** `at` is the base document's block index, which insertions do not have. */
type Op =
  | { type: "same"; block: string; at: number }
  | { type: "del"; block: string; at: number }
  | { type: "ins"; block: string }
  | { type: "replace"; base: string; other: string; at: number };

/**
 * A replaced run holds the base's blocks and the other's, and nothing says the
 * first of one is a draft of the first of the other. Each pair close enough to
 * merge is merged; what pairs with nothing is shown whole. Greedy on the best
 * scores, which is as much cleverness as a run of a few blocks can repay.
 */
const pairReplaced = (removed: string[], added: string[], baseStart: number): Op[] => {
  if (removed.length * added.length > PAIRING_CAP) {
    const paired = Math.min(removed.length, added.length);
    return [
      ...removed.slice(0, paired).map((block, i): Op => {
        const other = added[i] as string;
        return { type: "replace", base: block, other, at: baseStart + i };
      }),
      ...removed
        .slice(paired)
        .map((block, i): Op => ({ type: "del", block, at: baseStart + paired + i })),
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
  const ops: Op[] = [];
  removed.forEach((block, i) => {
    if (!taken.has(i)) ops.push({ type: "del", block, at: baseStart + i });
  });
  added.forEach((block, j) => {
    const i = baseOf.get(j);
    ops.push(
      i === undefined
        ? { type: "ins", block }
        : { type: "replace", base: removed[i] as string, other: block, at: baseStart + i },
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
      const baseStart = ia;
      ia += count;
      if (next?.added) {
        const added = otherBlocks.slice(ib, ib + next.value.length);
        ib += next.value.length;
        at++;
        ops.push(...pairReplaced(removed, added, baseStart));
      } else {
        ops.push(...removed.map((block, i): Op => ({ type: "del", block, at: baseStart + i })));
      }
    } else if (part.added) {
      ops.push(...otherBlocks.slice(ib, ib + count).map((block): Op => ({ type: "ins", block })));
      ib += count;
    } else {
      ops.push(
        ...baseBlocks
          .slice(ia, ia + count)
          .map((block, i): Op => ({ type: "same", block, at: ia + i })),
      );
      ia += count;
      ib += count;
    }
  }
  return ops;
};

const prepare = (base: string, other: string, options: MarkdownDiffOptions) => {
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

  return { ops: planOps(from.blocks, to.blocks), renderOp };
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
  const { ops, renderOp } = prepare(base, other, options);
  return {
    html: ops.map(renderOp).join("\n"),
    similarity: textSimilarity(base, other),
    changed: ops.some((op) => op.type !== "same"),
  };
};

export type MarkdownChange = {
  /**
   * The base document's block the change sits at, counted over the blocks the
   * source cuts into. `-1` with `placement: "after"` is before everything.
   */
  anchor: number;
  /** `at`: this block reads differently or is absent. `after`: blocks added past it. */
  placement: "at" | "after";
  /** The change rendered the way `diffMarkdown` renders it, and nothing around it. */
  html: string;
};

export type MarkdownComparison = {
  similarity: number;
  changed: boolean;
  changes: MarkdownChange[];
};

/**
 * The same reading as `diffMarkdown`, kept apart from the document instead of
 * merged into it: one entry per run of contiguous difference, anchored to the
 * base block it concerns, so a page showing the base document can mark the
 * places another version touches and unfold each one where it stands.
 */
export const compareMarkdown = (
  base: string,
  other: string,
  options: MarkdownDiffOptions = {},
): MarkdownComparison => {
  const { ops, renderOp } = prepare(base, other, options);

  const changes: MarkdownChange[] = [];
  let run: Op[] = [];
  let lastBase = -1;

  const flush = () => {
    if (run.length === 0) return;
    const pieces = run.map(renderOp);
    // A run whose merged rendering carries no mark reads identically: the
    // sources differ in something a reader cannot see, a link target most
    // often, and a mark that unfolds into nothing teaches only distrust.
    const visible = run.some(
      (op, at) => op.type !== "replace" || /<(?:ins|del)>/.test(pieces[at] ?? ""),
    );
    if (visible) {
      const anchored: number[] = [];
      for (const op of run) if (op.type !== "ins") anchored.push(op.at);
      changes.push({
        anchor: anchored.length > 0 ? Math.min(...anchored) : lastBase,
        placement: anchored.length > 0 ? "at" : "after",
        html: pieces.join("\n"),
      });
    }
    run = [];
  };

  for (const op of ops) {
    if (op.type === "same") {
      flush();
      lastBase = op.at;
    } else {
      run.push(op);
    }
  }
  flush();

  return {
    similarity: textSimilarity(base, other),
    changed: changes.length > 0,
    changes,
  };
};

export type BlockAnchor = {
  /** The block's source, whitespace collapsed: a last resort for finding it by content. */
  text: string;
  /** Whether the document pipeline draws this block as a top level element of the page. */
  rendered: boolean;
};

const normalizeTitle = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

const headingText = (source: string): string =>
  source
    .replace(/^#{1,6}[ \t]*/, "")
    .replace(/[ \t]*#*[ \t]*$/, "")
    .replace(/\n[=-]+[ \t]*$/, "");

/** The kinds of block a page renders nothing for, in place: they resolve elsewhere. */
const INVISIBLE = new Set(["definition", "footnoteDefinition", "html"]);

/**
 * One entry per base block, aligned with `compareMarkdown`'s anchors, saying
 * whether the rendered page holds an element for it. The page drops a leading
 * heading that repeats the given title, renders link and footnote definitions
 * into other places, and strips raw HTML, so counting rendered blocks up to an
 * anchor is what turns a block index into a position among the page's elements.
 */
export const blockAnchors = (content: string, title?: string): BlockAnchor[] => {
  const blocks = parsedBlocks(content);
  const anchors = blocks.map((block) => ({
    text: normalize(block.source),
    rendered: !INVISIBLE.has(block.type),
  }));

  if (title !== undefined) {
    const first = blocks.findIndex((block) => !INVISIBLE.has(block.type));
    const opening = blocks[first];
    if (
      opening !== undefined &&
      opening.type === "heading" &&
      opening.depth === 1 &&
      normalizeTitle(headingText(opening.source)) === normalizeTitle(title)
    ) {
      const anchor = anchors[first];
      if (anchor !== undefined) anchor.rendered = false;
    }
  }
  return anchors;
};
