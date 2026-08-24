import { renderMarkdown } from "@openspecs/markdown";
import type { SpecKindEntry } from "@openspecs/nostr";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { STATUS_TONE } from "~/components/spec-tags";

/**
 * Without a width, so a field that wants its own can say so. Composing a width
 * onto `FIELD` below does not work: both are the same property, and which one
 * wins is decided by the order Tailwind emits them rather than the order they
 * are written here.
 */
const FIELD_BASE =
  "rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

export const FIELD = `w-full ${FIELD_BASE}`;

export const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

export const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

export const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

export const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

export const LABEL = "block font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted";

/** Dashed, because it is on offer rather than anything this document says yet. */
export const SUGGESTION =
  "rounded-sm border border-dashed border-rule px-2 py-1 font-mono text-[0.6875rem] text-muted hover:border-muted hover:text-ink";

const REMOVE =
  "shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-signal-closed";

/**
 * A form with one submit button publishes when Enter is pressed in any single
 * line field in it. Saving a profile that way is a convenience; publishing a
 * document that way fixes its address forever, so every one line field here
 * refuses the key and the button is the only way through.
 */
export const notEnter = (event: React.KeyboardEvent) => {
  if (event.key === "Enter") event.preventDefault();
};

export const Row = ({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: (id: string) => React.ReactNode;
}) => {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {note !== undefined && <div className={NOTE}>{note}</div>}
    </div>
  );
};

/**
 * Where the document will be found, shown under the title it is taken from
 * rather than beside it as a field of its own. It writes itself, and once a
 * document is published it never moves again, so somebody writing one should
 * read it and carry on rather than answer it.
 *
 * Still shown, and never merely implied: it is the one decision here that cannot
 * be taken back, and publishing an address nobody saw is worse than a line of
 * small type.
 */
export const IdentifierField = ({
  value,
  locked,
  suggestion,
  onChange,
}: {
  value: string;
  locked: boolean;
  /** What the title would give, offered only while it differs from what is typed. */
  suggestion: string | null;
  onChange: (identifier: string) => void;
}) => {
  const [open, setOpen] = useState(false);

  if (locked || !open) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 break-all font-mono text-[0.6875rem] text-muted">
          /spec/npub1…/<span className="text-ink">{value || "a-short-name"}</span>
        </p>
        {locked ? (
          <span className="font-mono text-[0.6875rem] text-muted">set when first published</span>
        ) : (
          <button type="button" className={SUGGESTION} onClick={() => setOpen(true)}>
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        className={`${FIELD} max-w-xs`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="a-short-name"
        spellCheck={false}
        onKeyDown={notEnter}
        aria-label="The last part of this document's link"
      />
      <p className={NOTE}>
        The last part of this document's link. It is set once, when the document is first published,
        and never changes after that.
      </p>
      {suggestion !== null && (
        <button type="button" className={SUGGESTION} onClick={() => onChange(suggestion)}>
          Use {suggestion}
        </button>
      )}
    </div>
  );
};

/**
 * Free text with a list to pick from rather than a menu to choose in. The
 * schema names no status at all and `SpecTags` colours the words documents
 * happen to use, so a menu here would make this site the authority on a
 * vocabulary it does not own.
 */
const SUGGESTED_STATUSES = [
  "draft",
  "proposal",
  "experimental",
  "accepted",
  "active",
  "final",
  "stable",
  "deprecated",
  "withdrawn",
];

export const StatusField = ({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (status: string) => void;
}) => {
  const list = useId();
  const tone = STATUS_TONE[value.trim().toLowerCase()] ?? "text-ink";
  return (
    <>
      <input
        id={id}
        list={list}
        className={`${FIELD} ${value.trim() === "" ? "" : tone}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        onKeyDown={notEnter}
      />
      <datalist id={list}>
        {SUGGESTED_STATUSES.map((status) => (
          <option key={status} value={status} />
        ))}
      </datalist>
    </>
  );
};

/**
 * Rows rather than one comma separated field, because a topic is a tag of its
 * own and a comma is a character somebody may want inside one.
 *
 * A topic typed here is folded to lower case and its spaces are closed up.
 * Nothing forbids either: a tag value is any string, and a relay will happily
 * answer a filter for `Event Kinds`. But every other client writes its `t` tags
 * from the hashtags in a document, and a hashtag has no capitals to speak of and
 * stops at the first space, so a topic with either is one nobody else can ever
 * produce and therefore one that finds nothing and is found by nothing.
 *
 * A topic that arrived from the published document keeps whatever it had, since
 * this page does not get to quietly change what somebody else chose.
 */
export const TopicField = ({
  id,
  topics,
  onChange,
}: {
  id: string;
  topics: string[];
  onChange: (topics: string[]) => void;
}) => {
  const [adding, setAdding] = useState("");

  const add = () => {
    const topic = adding
      .trim()
      .replace(/^#+/, "")
      .toLowerCase()
      // Hyphenated rather than split in two: "event kinds" is one topic somebody
      // named, and the chip below shows what it became the moment it is added.
      .replace(/\s+/g, "-");
    if (topic === "" || topics.includes(topic)) {
      setAdding("");
      return;
    }
    onChange([...topics, topic]);
    setAdding("");
  };

  return (
    <div className="space-y-2">
      {topics.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <li
              key={topic}
              className="flex items-center gap-2 rounded-sm border border-rule px-2 py-1"
            >
              <span className="font-mono text-[0.6875rem]">#{topic}</span>
              <button
                type="button"
                className={REMOVE}
                onClick={() => onChange(topics.filter((other) => other !== topic))}
                aria-label={`Remove #${topic}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          id={id}
          className={`${FIELD} min-w-0 flex-1`}
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Or the form around this takes it as a request to publish.
            event.preventDefault();
            add();
          }}
          spellCheck={false}
        />
        <button
          type="button"
          className={`${ACTION} shrink-0`}
          onClick={add}
          disabled={adding.trim() === ""}
        >
          Add
        </button>
      </div>
    </div>
  );
};

/**
 * The event kinds a document is about. Behind a disclosure, closed, and last:
 * only a document about Nostr declares any, most declare none, and somebody
 * writing about anything else should not have to walk past the largest control
 * on the page to reach the end of the form.
 *
 * A value that is not a number is accepted without complaint, since documents in
 * the wild carry those too.
 */
export const KindField = ({
  kinds,
  onChange,
}: {
  kinds: SpecKindEntry[];
  onChange: (kinds: SpecKindEntry[]) => void;
}) => {
  const at = (index: number, entry: SpecKindEntry) =>
    onChange(kinds.map((held, position) => (position === index ? entry : held)));

  const declared = kinds.filter((entry) => entry.raw.trim() !== "").length;

  return (
    <details open={declared > 0}>
      <summary className="cursor-pointer font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink">
        Event kinds
        <span className="ml-3 normal-case tracking-normal">
          {declared === 0 ? "none" : declared === 1 ? "1 kind" : `${declared} kinds`}
        </span>
      </summary>

      <div className="mt-4 space-y-2">
        <p className={NOTE}>
          Only for a document about Nostr, to say which event kinds it covers. A document about
          anything else leaves this empty.
        </p>

        {kinds.map((entry, index) => (
          <div
            // The value moves as it is typed, so only its place identifies a row.
            // biome-ignore lint/suspicious/noArrayIndexKey: a row has no other identity
            key={index}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              className={`${FIELD_BASE} w-20`}
              value={entry.raw}
              onChange={(event) => at(index, { ...entry, raw: event.target.value })}
              placeholder="30817"
              spellCheck={false}
              onKeyDown={notEnter}
              aria-label="Event kind"
            />
            <input
              className={`${FIELD} max-w-xs flex-1`}
              value={entry.name}
              onChange={(event) => at(index, { ...entry, name: event.target.value })}
              placeholder="What that kind is called"
              onKeyDown={notEnter}
              aria-label="What that kind is called"
            />
            <button
              type="button"
              className={REMOVE}
              onClick={() => onChange(kinds.filter((_, position) => position !== index))}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          className={ACTION}
          onClick={() => onChange([...kinds, { raw: "", name: "" }])}
        >
          Add a kind
        </button>
      </div>
    </details>
  );
};

/**
 * A field that grows with what is typed in it, so the page scrolls rather than
 * the box: a specification is thousands of words, and a window onto it that
 * scrolls inside a window that also scrolls is two places to lose your line.
 */
const useAutoGrow = (value: string) => {
  const area = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the value, which is read off the element rather than out of this scope
  useEffect(() => {
    const field = area.current;
    if (field === null) return;

    const measure = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    measure();

    // A narrower window wraps the same words onto more lines, and a height
    // measured at the old width clips them. A turned phone is the common case.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value]);

  return area;
};

/**
 * Set in the exact type the masthead of the published page uses, and drawn
 * without a box. A title typed at twelve pixels in a monospace field, the same
 * field an address is typed in, gives no sense of the thing being made: this one
 * is the thing being made, which is worth more than a label saying "Title".
 *
 * The focus ring this site draws around everything else is dropped here and on
 * the document below. It lands on fields that already have a border, where it
 * says which box is live; on a surface with no box of its own it is the only
 * rectangle on the page, and it would frame the whole document for as long as
 * anybody writes in it. The caret says the same thing and says it quietly.
 */
export const TitleField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (title: string) => void;
}) => {
  const area = useAutoGrow(value);
  return (
    <textarea
      ref={area}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\n/g, ""))}
      placeholder="What this document is called"
      aria-label="Title"
      spellCheck={false}
      className="writing w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-3xl font-medium leading-tight tracking-tight text-ink placeholder:text-muted sm:text-4xl"
    />
  );
};

/**
 * Under the title, set the way the published page sets it, rather than as a box
 * in the rail beside it. A summary is a sentence, and a sentence typed into a
 * sixteen rem field at twelve pixels arrives one word at a time through a slot:
 * the beginning of it has scrolled out of sight by the end, and rereading it
 * means dragging back through it.
 *
 * Multiple lines because it grows to hold what is written, not because a
 * summary has any: a pasted paragraph loses its line breaks on the way in, the
 * same as the title above.
 */
export const SummaryField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (summary: string) => void;
}) => {
  const area = useAutoGrow(value);
  return (
    <div className="space-y-1.5">
      <textarea
        ref={area}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, " "))}
        placeholder="One sentence"
        aria-label="Summary"
        className="writing w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-serif text-lg leading-relaxed text-ink placeholder:text-muted"
      />
      <p className={NOTE}>
        Shown wherever the document is listed, and under its title when it is read. Left empty, the
        opening paragraph is used.
      </p>
    </div>
  );
};

/**
 * The document itself, in the reading face at the reading measure, and without a
 * border for the same reason the published page has none around its prose. The
 * numbers match `.doc` in `app.css`, so what is written here is set exactly as
 * what will be read.
 *
 * The preview goes through the same renderer the server uses, with the same
 * options, so it is the published page rather than an approximation of it.
 */
export const DocumentField = ({
  content,
  title,
  onChange,
}: {
  content: string;
  title: string;
  onChange: (content: string) => void;
}) => {
  const [preview, setPreview] = useState(false);
  const { html } = useMemo(() => renderMarkdown(content, { title }), [content, title]);
  const area = useAutoGrow(preview ? "" : content);
  const empty = content.trim() === "";

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-t border-rule py-3">
        <span className={LABEL}>Document</span>
        {!empty && (
          <button type="button" className={CHROME} onClick={() => setPreview(!preview)}>
            {preview ? "Write" : "Preview"}
          </button>
        )}
      </div>

      {preview && !empty ? (
        <div
          className="doc min-h-[60vh]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by the pipeline above
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <textarea
          ref={area}
          value={content}
          onChange={(event) => onChange(event.target.value)}
          placeholder={"# A heading\n\nAnd a paragraph under it."}
          aria-label="Document"
          className="writing min-h-[60vh] w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-serif text-[1.0625rem] leading-[1.72] text-ink placeholder:text-muted"
        />
      )}
    </div>
  );
};
