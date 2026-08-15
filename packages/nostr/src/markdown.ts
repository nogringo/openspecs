const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

const withoutFencedCode = (lines: string[]): string[] => {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (fence === null && match?.[1]) {
      fence = match[1][0] ?? null;
      continue;
    }
    if (fence !== null && match?.[1]?.startsWith(fence)) {
      fence = null;
      continue;
    }
    if (fence === null) kept.push(line);
  }
  return kept;
};

const withoutFrontMatter = (lines: string[]): string[] => {
  if (lines[0]?.trim() !== "---") return lines;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  return end === -1 ? lines : lines.slice(end + 1);
};

const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;

/**
 * Drops both lines of a setext heading. The underline sits on the second line,
 * so block splitting alone reads `Title\n=====` as an ordinary paragraph and
 * the heading ends up in the description.
 */
const withoutSetextHeadings = (lines: string[]): string[] => {
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const next = lines[i + 1];
    if (line.trim() !== "" && next !== undefined && SETEXT_UNDERLINE.test(next)) {
      i++;
      continue;
    }
    kept.push(line);
  }
  return kept;
};

const prepare = (content: string): string[] =>
  withoutFencedCode(withoutFrontMatter(content.replace(/\r\n?/g, "\n").split("\n"))).filter(
    (line) => !/^\s*<!--/.test(line),
  );

const prepareForProse = (content: string): string[] => withoutSetextHeadings(prepare(content));

/** Strips the inline syntax that would otherwise leak into a meta description. */
export const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export const firstHeading = (content: string): string | null => {
  const lines = prepare(content);
  for (const [i, line] of lines.entries()) {
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx?.[1]) return stripInlineMarkdown(atx[1]) || null;
    const next = lines[i + 1];
    if (line.trim() !== "" && next && /^\s{0,3}(=+|-+)\s*$/.test(next)) {
      return stripInlineMarkdown(line) || null;
    }
  }
  return null;
};

const isProse = (block: string): boolean => {
  const trimmed = block.trim();
  if (trimmed === "") return false;
  if (/^\s{0,3}#{1,6}\s/.test(trimmed)) return false;
  if (/^\s{0,3}(=+|-+|\*{3,}|_{3,})\s*$/.test(trimmed)) return false;
  if (/^\s{0,3}[|>]/.test(trimmed)) return false;
  if (/^\s{0,3}</.test(trimmed)) return false;
  // Specifications commonly open on a status line such as `draft` `optional`.
  // A block made only of code spans is metadata markup, never an abstract.
  if (trimmed.replace(/`[^`]*`/g, "").trim() === "") return false;
  // A block made only of images or links is a badge row, not an abstract.
  return stripInlineMarkdown(trimmed) !== "";
};

const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:]+$/, "")}...`;
};

/**
 * The description shown to crawlers and link unfurlers. Derived rather than read
 * from a tag: a `summary` tag exists on a small minority of published documents,
 * while a first paragraph exists on nearly all of them.
 */
export const deriveSummary = (content: string, maxLength = 160): string => {
  const blocks = prepareForProse(content)
    .join("\n")
    .split(/\n\s*\n/);
  const prose = blocks.find(isProse);
  if (!prose) return "";
  const listItem = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;
  const text = stripInlineMarkdown(
    prose
      .split("\n")
      .map((line) => line.replace(listItem, ""))
      .join(" "),
  );
  return truncate(text, maxLength);
};
