/**
 * The same faces the editor's fields use, spelled here rather than imported:
 * that module carries the Markdown renderer with it, and the author page has
 * no other reason to load one.
 */
export const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

export const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

/** Dashed, because it is on offer rather than anything said yet. */
export const SUGGESTION =
  "rounded-sm border border-dashed border-rule px-2 py-1 font-mono text-[0.6875rem] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

export const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 text-ink placeholder:text-muted";
