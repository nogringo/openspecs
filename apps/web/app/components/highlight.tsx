import { matchSpans } from "~/lib/search";

/** Marks what the reader typed inside a title, a summary or an excerpt. */
export const Highlight = ({ text, terms }: { text: string; terms?: string[] }) => {
  const spans = terms?.length ? matchSpans(text, terms) : [];
  if (spans.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.at > cursor) parts.push(text.slice(cursor, span.at));
    parts.push(
      <mark key={span.at} className="bg-shade text-ink">
        {text.slice(span.at, span.at + span.length)}
      </mark>,
    );
    cursor = span.at + span.length;
  }
  parts.push(text.slice(cursor));

  return <>{parts}</>;
};
