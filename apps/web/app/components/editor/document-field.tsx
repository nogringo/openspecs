import { type MarkdownHeading, renderMarkdown } from "@openspecs/markdown";
import {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Anchor, type Edit, indentEdit, locate, place } from "~/lib/editing";
import { LABEL, useGrow } from "./fields";

export type View = "write" | "preview" | "changes";

/** A quarter of the way down the window, where the eye rests: what stays put when the view changes. */
const READING_LINE = 0.25;

/** The room left above a heading jumped to, matching `scroll-margin-top` on `.doc` headings. */
const MARGIN = 32;

/** Everything that decides where a line of a textarea wraps. */
const MIRRORED = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-feature-settings",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "tab-size",
  "overflow-wrap",
  "word-break",
];

/**
 * How far below the top of a textarea each offset of its text sits. A textarea
 * cannot say where its lines are, so the same text is set in a copy of it
 * nobody sees, with a mark at each offset.
 */
const offsetTops = (area: HTMLTextAreaElement, offsets: number[]): number[] => {
  const style = getComputedStyle(area);
  const mirror = document.createElement("div");
  for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(mirror.style, {
    position: "absolute",
    top: "0",
    left: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
  });

  const value = area.value;
  const marks: HTMLSpanElement[] = [];
  let at = 0;
  for (const offset of offsets) {
    const to = Math.min(Math.max(offset, at), value.length);
    mirror.append(value.slice(at, to));
    const mark = document.createElement("span");
    mirror.append(mark);
    marks.push(mark);
    at = to;
  }
  mirror.append(value.slice(at));

  document.body.append(mirror);
  const tops = marks.map((mark) => mark.offsetTop);
  mirror.remove();
  return tops;
};

const pageTop = (element: Element): number => element.getBoundingClientRect().top + window.scrollY;

const readingLine = (): number => window.innerHeight * READING_LINE;

/**
 * The document field's state, held by the editor because the rail beside it
 * draws the contents and the publish button opens the changes.
 *
 * Switching between writing and the preview keeps the place being read: both
 * are cut at the same headings, so a point a third of the way through a
 * section lands a third of the way through it in the other.
 */
export const useDocument = (content: string, title: string) => {
  const [view, setView] = useState<View>("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const page = useRef<HTMLDivElement>(null);
  // Rendered a beat behind the typing, so a long document does not run the
  // whole pipeline between two keystrokes.
  const deferred = useDeferredValue(content);
  const rendered = useMemo(() => renderMarkdown(deferred, { title }), [deferred, title]);
  const pending = useRef<{ anchor: Anchor | null } | null>(null);
  const beforeChanges = useRef<Anchor | null>(null);

  /** The top of the document, each heading, and its bottom, as drawn in the view on screen. */
  const edges = (shown: View): number[] | null => {
    if (shown === "write") {
      const field = area.current;
      if (field === null) return null;
      const top = pageTop(field);
      const tops = offsetTops(
        field,
        rendered.headings.map((heading) => heading.offset),
      );
      return [top, ...tops.map((offset) => top + offset), top + field.offsetHeight];
    }
    if (shown === "preview") {
      const drawn = page.current;
      if (drawn === null) return null;
      const marks = rendered.headings.map((heading) =>
        drawn.querySelector(`[id="${CSS.escape(heading.id)}"]`),
      );
      if (marks.some((mark) => mark === null)) return null;
      const top = pageTop(drawn);
      return [
        top,
        ...marks.map((mark) => (mark === null ? top : pageTop(mark))),
        top + drawn.offsetHeight,
      ];
    }
    return null;
  };

  const anchor = (): Anchor | null => {
    const drawn = edges(view);
    return drawn === null ? null : locate(drawn, window.scrollY + readingLine());
  };

  const show = (next: View) => {
    if (next === view) return;
    if (next === "changes") beforeChanges.current = anchor();
    pending.current = { anchor: view === "changes" ? beforeChanges.current : anchor() };
    setView(next);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per change of view, measuring the page as it is drawn then
  useLayoutEffect(() => {
    const held = pending.current;
    if (held === null) return;
    pending.current = null;

    if (view === "changes") {
      // A review reads from the top, wherever the button that opened it was.
      const top = page.current?.getBoundingClientRect().top;
      if (top !== undefined && top < 0) window.scrollBy(0, top - MARGIN);
      return;
    }

    if (view === "write") area.current?.focus({ preventScroll: true });
    const drawn = held.anchor === null ? null : edges(view);
    const y = drawn === null || held.anchor === null ? null : place(drawn, held.anchor);
    if (y !== null) window.scrollTo(0, y - readingLine());
  }, [view]);

  const jump = (heading: MarkdownHeading) => {
    if (view === "preview") {
      page.current
        ?.querySelector(`[id="${CSS.escape(heading.id)}"]`)
        ?.scrollIntoView({ block: "start" });
      return;
    }
    const field = area.current;
    if (view !== "write" || field === null) return;
    const offset = Math.min(heading.offset, field.value.length);
    const [top = 0] = offsetTops(field, [offset]);
    field.setSelectionRange(offset, offset);
    field.focus({ preventScroll: true });
    window.scrollTo(0, pageTop(field) + top - MARGIN);
  };

  return { view, show, area, page, rendered, jump };
};

export type DocumentView = ReturnType<typeof useDocument>;

/** Through the browser rather than around it, so Undo takes an indent back like any typing. */
const applyEdit = (field: HTMLTextAreaElement, edit: Edit, onChange: (value: string) => void) => {
  field.setSelectionRange(edit.from, edit.to);
  const typed =
    edit.text === ""
      ? document.execCommand("delete")
      : document.execCommand("insertText", false, edit.text);
  if (!typed) {
    field.setRangeText(edit.text, edit.from, edit.to);
    onChange(field.value);
  }
  field.setSelectionRange(...edit.select);
};

/**
 * Spelled out rather than built on `CHROME`: a colour composed onto one that
 * already sets a colour wins by Tailwind's order, not by being written last.
 */
const VIEW_BUTTON =
  "rounded-sm border px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em]";
const SHOWN = `${VIEW_BUTTON} border-muted text-ink`;
const NOT_SHOWN = `${VIEW_BUTTON} border-rule text-muted hover:border-muted hover:text-ink`;

const VIEWS: { view: View; label: string }[] = [
  { view: "write", label: "Write" },
  { view: "preview", label: "Preview" },
  { view: "changes", label: "Changes" },
];

/**
 * The document itself, in the reading face at the reading measure, and without a
 * border for the same reason the published page has none around its prose. The
 * numbers match `.doc` in `app.css`, so what is written here is set exactly as
 * what will be read.
 *
 * The preview goes through the same renderer the server uses, with the same
 * options, so it is the published page rather than an approximation of it. The
 * textarea stays in the page while it is hidden, so coming back to it finds the
 * caret where it was and Undo still remembers.
 *
 * Tab indents, since a specification is full of JSON. Escape, then Tab, leaves
 * the field, and the line saying so is read out to whoever arrives in it.
 */
export const DocumentField = ({
  doc,
  content,
  onChange,
  comparable,
  changes,
}: {
  doc: DocumentView;
  content: string;
  onChange: (content: string) => void;
  /** Whether there is a published text to set this one against. */
  comparable: boolean;
  changes: React.ReactNode;
}) => {
  const hint = useId();
  const [typing, setTyping] = useState(false);
  const released = useRef(false);
  const empty = content.trim() === "";
  const writing = doc.view === "write";

  useGrow(doc.area, content, writing);

  const { view, show } = doc;
  useEffect(() => {
    if ((view === "preview" && empty) || (view === "changes" && !comparable)) show("write");
  });

  const offered = VIEWS.filter(
    (option) => (option.view !== "preview" || !empty) && (option.view !== "changes" || comparable),
  );

  const keys = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      released.current = true;
      return;
    }
    if (
      event.key === "Tab" &&
      !released.current &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      const field = event.currentTarget;
      const edit = indentEdit(
        field.value,
        field.selectionStart,
        field.selectionEnd,
        event.shiftKey,
      );
      if (edit !== null) applyEdit(field, edit, onChange);
      return;
    }
    released.current = false;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule py-3">
        <div className="flex items-baseline gap-3">
          <span className={LABEL}>Document</span>
          <span
            id={hint}
            className={`font-mono text-[0.6875rem] text-muted ${typing ? "" : "invisible"}`}
          >
            Tab indents. Esc, then Tab, moves on.
          </span>
        </div>
        {offered.length > 1 && (
          <div className="flex gap-2">
            {offered.map((option) => (
              <button
                key={option.view}
                type="button"
                className={option.view === doc.view ? SHOWN : NOT_SHOWN}
                aria-pressed={option.view === doc.view}
                onClick={() => doc.show(option.view)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <textarea
        ref={doc.area}
        hidden={!writing}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keys}
        onFocus={() => {
          released.current = false;
          setTyping(true);
        }}
        onBlur={() => setTyping(false)}
        placeholder={"# A heading\n\nAnd a paragraph under it."}
        aria-label="Document"
        aria-describedby={hint}
        className="writing min-h-[60vh] w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-serif text-[1.0625rem] leading-[1.72] text-ink placeholder:text-muted"
      />

      {doc.view === "preview" && (
        <div
          ref={doc.page}
          className="doc min-h-[60vh]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by the pipeline above
          dangerouslySetInnerHTML={{ __html: doc.rendered.html }}
        />
      )}

      {doc.view === "changes" && (
        <div ref={doc.page} className="min-h-[60vh]">
          {changes}
        </div>
      )}
    </div>
  );
};

/**
 * The headings of what is being written, in the rail the reading page keeps its
 * contents in, to get about a document that takes a morning to scroll. Not on a
 * phone, where the rail sits below the whole document.
 */
export const Outline = ({ doc }: { doc: DocumentView }) => {
  const listed = doc.rendered.headings.filter((heading) => heading.depth <= 3);
  if (listed.length === 0 || doc.view === "changes") return null;

  return (
    <nav aria-label="Contents" className="hidden space-y-3 border-t border-rule pt-6 lg:block">
      <p className={LABEL}>Contents</p>
      <ul className="space-y-2 font-mono text-xs leading-snug">
        {listed.map((heading) => (
          <li
            key={heading.id}
            style={{ paddingLeft: `${Math.max(0, heading.depth - 2) * 0.75}rem` }}
          >
            <button
              type="button"
              title={heading.text}
              onClick={() => doc.jump(heading)}
              className="line-clamp-2 text-left text-muted hover:text-ink"
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};
