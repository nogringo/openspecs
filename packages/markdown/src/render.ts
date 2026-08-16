import type { Element, Root } from "hast";
import { toString as textOf } from "hast-util-to-string";
import rehypeAutolinkHeadings, { type Options as AutolinkOptions } from "rehype-autolink-headings";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";

export type MarkdownHeading = {
  id: string;
  /** As rendered, so a table of contents can indent on it directly. */
  depth: number;
  text: string;
};

export type RenderedMarkdown = {
  html: string;
  headings: MarkdownHeading[];
  /** Every http address the document points at, once each, in reading order. */
  links: string[];
};

export type RenderOptions = {
  /**
   * The page title. A leading level one heading repeating it is dropped, since
   * most documents open on their own title and the page already shows it.
   */
  title?: string;
  /**
   * Levels added to every heading. Defaults to one when the document still
   * holds a level one heading of its own, so the page keeps a single `h1`,
   * and to zero once that heading has been dropped as a repeated title.
   */
  headingOffset?: number;
};

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const normalizeTitle = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

const dropRepeatedTitle = (tree: Root, title: string) => {
  const first = tree.children.find((node) => node.type !== "comment" && node.type !== "doctype");
  if (first?.type !== "element" || first.tagName !== "h1") return;
  if (normalizeTitle(textOf(first)) !== normalizeTitle(title)) return;
  tree.children.splice(tree.children.indexOf(first), 1);
};

const hasTopHeading = (tree: Root): boolean => {
  let found = false;
  visit(tree, "element", (node: Element) => {
    if (node.tagName === "h1") found = true;
  });
  return found;
};

const restructureHeadings = (options: RenderOptions) => (tree: Root) => {
  if (options.title) dropRepeatedTitle(tree, options.title);
  const shift = options.headingOffset ?? (hasTopHeading(tree) ? 1 : 0);
  if (shift === 0) return;
  visit(tree, "element", (node: Element) => {
    if (!HEADINGS.has(node.tagName)) return;
    node.tagName = `h${Math.min(6, Number(node.tagName.slice(1)) + shift)}`;
  });
};

/**
 * Untrusted authors, so outgoing links carry no endorsement and cannot reach
 * back through `window.opener`.
 */
const hardenLinks = () => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    if (node.tagName === "a" && /^[a-z][a-z0-9+.-]*:/i.test(String(node.properties.href ?? ""))) {
      node.properties.rel = ["nofollow", "noopener", "noreferrer"];
    }
    if (node.tagName === "img") {
      node.properties.loading = "lazy";
      node.properties.decoding = "async";
    }
  });
};

/**
 * Only the links a reader could follow: the same address written twice is one
 * citation, and an anchor into the document itself cites nothing.
 */
const collectLinks = (links: Set<string>) => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "a") return;
    const href = String(node.properties.href ?? "");
    if (/^https?:\/\//i.test(href)) links.add(href);
  });
};

const collectHeadings = (headings: MarkdownHeading[]) => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    // The footnote label is generated, not written, and belongs to no section.
    if (node.properties.dataFootnotes !== undefined) return SKIP;
    if (!HEADINGS.has(node.tagName)) return;
    const id = String(node.properties.id ?? "");
    if (id !== "") headings.push({ id, depth: Number(node.tagName.slice(1)), text: textOf(node) });
  });
};

/**
 * A permalink on every heading a reader can navigate to, so a section can be
 * cited without going through the table of contents. Linking exactly what was
 * collected keeps the two ways of reaching a section in step.
 */
const linkHeadings = (headings: MarkdownHeading[]): AutolinkOptions => ({
  behavior: "append",
  test: (heading) => headings.some(({ id }) => id === heading.properties.id),
  properties: (heading) => ({
    className: ["heading-anchor"],
    ariaLabel: `Link to ${textOf(heading)}`,
  }),
  content: {
    type: "element",
    tagName: "span",
    properties: { ariaHidden: "true" },
    children: [{ type: "text", value: "#" }],
  },
});

/**
 * GitHub's schema, minus the `user-content-` prefix it forces on identifiers.
 * Raw HTML never reaches the tree, so the only identifiers to guard against
 * clobbering are the ones this pipeline generates itself, and prefixing them
 * would only break the footnote links pointing at them.
 */
const schema = { ...defaultSchema, clobberPrefix: "" };

/**
 * Sanitizing before slugs and link hardening rather than last: those plugins
 * emit trusted markup, and running them after keeps their attributes out of
 * the schema, which is the part that must stay strict.
 */
export const renderMarkdown = (content: string, options: RenderOptions = {}): RenderedMarkdown => {
  const headings: MarkdownHeading[] = [];
  const links = new Set<string>();
  const html = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { clobberPrefix: "" })
    .use(rehypeSanitize, schema)
    .use(restructureHeadings, options)
    .use(rehypeSlug)
    .use(collectHeadings, headings)
    // After the collection, or the permalink sign would read as heading text.
    .use(rehypeAutolinkHeadings, linkHeadings(headings))
    .use(collectLinks, links)
    .use(hardenLinks)
    .use(rehypeStringify)
    .processSync(content)
    .toString();

  return { html, headings, links: [...links] };
};
