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
  /**
   * How to draw a `nostr:` reference. Left out, they stay the bech32 text they
   * were: this package knows nothing about keys, and the caller that does can
   * turn one into a name.
   */
  mention?: MentionResolver;
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

/**
 * What a `nostr:` reference should be drawn as. Returning null leaves it as the
 * text it was, which is the honest outcome for a reference nothing can resolve.
 *
 * A `color` is what tells two people with the same name apart. It is a CSS
 * colour the caller derives from the key itself, never anything an author wrote.
 */
export type Mention = { label: string; href?: string; color?: string };

export type MentionResolver = (uri: string) => Mention | null;

/** NIP-21, and bech32's alphabet, which is the one without `1`, `b`, `i` and `o`. */
const NOSTR_URI =
  /nostr:((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;

/**
 * A bech32 identifier is sixty characters of noise to a reader, and a comment
 * opening on seven of them says nothing at all. This turns each one into
 * whatever the caller can make of it, usually a name and a link.
 *
 * Left alone inside a link, which already says where it goes, and inside code,
 * where an identifier is the subject rather than a reference.
 */
const drawMentions = (resolve: MentionResolver | undefined) => (tree: Root) => {
  if (resolve === undefined) return;

  visit(tree, "text", (node, index, parent) => {
    if (index === undefined || parent === null || parent === undefined) return;
    if (parent.type === "element" && ["a", "code", "pre"].includes(parent.tagName)) return SKIP;

    NOSTR_URI.lastIndex = 0;
    if (!NOSTR_URI.test(node.value)) return;
    NOSTR_URI.lastIndex = 0;

    const children: (Element | { type: "text"; value: string })[] = [];
    let taken = 0;
    for (const match of node.value.matchAll(NOSTR_URI)) {
      const uri = match[1];
      const mention = uri === undefined ? null : resolve(uri);
      if (mention === null) continue;

      if (match.index > taken) {
        children.push({ type: "text", value: node.value.slice(taken, match.index) });
      }
      // Inline rather than a class: this plugin runs after the sanitiser, on
      // markup it wrote itself, and the colour is one of a key's own.
      const tint = mention.color === undefined ? {} : { style: `color:${mention.color}` };
      children.push(
        mention.href === undefined
          ? {
              type: "element",
              tagName: "span",
              properties: { className: ["mention"], ...tint },
              children: [{ type: "text", value: mention.label }],
            }
          : {
              type: "element",
              tagName: "a",
              properties: { href: mention.href, className: ["mention"], ...tint },
              children: [{ type: "text", value: mention.label }],
            },
      );
      taken = match.index + match[0].length;
    }

    if (children.length === 0) return;
    if (taken < node.value.length) {
      children.push({ type: "text", value: node.value.slice(taken) });
    }
    parent.children.splice(index, 1, ...(children as Element[]));
    return index + children.length;
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
    // After the collection: a mention is a reference to a key, not a cited link.
    .use(drawMentions, options.mention)
    .use(hardenLinks)
    .use(rehypeStringify)
    .processSync(content)
    .toString();

  return { html, headings, links: [...links] };
};
