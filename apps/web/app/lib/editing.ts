/** Two spaces, the indent most JSON in specifications is written with. */
export const INDENT = "  ";

/** A replacement of `from` to `to` by `text`, and the selection to leave once it is made. */
export type Edit = { from: number; to: number; text: string; select: [number, number] };

/**
 * What Tab and Shift+Tab do to a textarea. A caret, or a selection inside one
 * line, gets two spaces where it stands. A selection across lines indents each
 * of them, and Shift+Tab takes up to two spaces off every line it touches. Null
 * when the key would change nothing.
 */
export const indentEdit = (
  value: string,
  start: number,
  end: number,
  outdent: boolean,
): Edit | null => {
  const across = value.slice(start, end).includes("\n");
  if (!outdent && !across) {
    return { from: start, to: end, text: INDENT, select: [start + 2, start + 2] };
  }

  const from = value.lastIndexOf("\n", start - 1) + 1;
  // A selection ending at the start of a line does not reach into that line.
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = value.indexOf("\n", last);
  const to = lineEnd === -1 ? value.length : lineEnd;

  const block = value.slice(from, to);
  const text = block
    .split("\n")
    .map((line) => {
      if (outdent) return line.replace(/^( {1,2}|\t)/, "");
      return line === "" ? line : `${INDENT}${line}`;
    })
    .join("\n");
  if (text === block) return null;

  if (across) return { from, to, text, select: [from, from + text.length] };
  const removed = block.length - text.length;
  const caret = Math.max(from, start - removed);
  return { from, to, text, select: [caret, Math.max(caret, end - removed)] };
};

/** A point in a document as section and distance through it, which survives being drawn again. */
export type Anchor = { section: number; through: number };

/**
 * Where `y` falls among the edges of a document's sections: its top, each
 * heading, its bottom, in page pixels. Null when `y` is outside the document.
 */
export const locate = (edges: number[], y: number): Anchor | null => {
  for (let section = 0; section < edges.length - 1; section++) {
    const top = edges[section] ?? 0;
    const bottom = edges[section + 1] ?? top;
    if (y >= top && y < bottom) {
      return { section, through: bottom > top ? (y - top) / (bottom - top) : 0 };
    }
  }
  return null;
};

/** The page pixel an anchor lands on among another drawing's edges. */
export const place = (edges: number[], anchor: Anchor): number | null => {
  const top = edges[anchor.section];
  const bottom = edges[anchor.section + 1];
  if (top === undefined || bottom === undefined) return null;
  return top + anchor.through * (bottom - top);
};
