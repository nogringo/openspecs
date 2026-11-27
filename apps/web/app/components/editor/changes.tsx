import { diffMarkdown } from "@openspecs/markdown";
import type { SpecDraft } from "@openspecs/nostr";
import { useMemo } from "react";
import { LABEL, NOTE } from "./fields";

const one = (value: string): string[] => (value.trim() === "" ? [] : [value.trim()]);

/** Read the way `editSpec` writes them, so a trailing space or a blank row is no change. */
const FIELDS: [string, (draft: SpecDraft) => string[]][] = [
  ["Address", (draft) => one(draft.identifier)],
  ["Title", (draft) => one(draft.title)],
  ["Summary", (draft) => one(draft.summary)],
  ["Status", (draft) => one(draft.status)],
  ["Topics", (draft) => [...new Set(draft.topics.flatMap(one))].map((topic) => `#${topic}`)],
  [
    "Event kinds",
    (draft) =>
      draft.kinds
        .filter((entry) => entry.raw.trim() !== "")
        .map((entry) => `${entry.raw.trim()} ${entry.name.trim()}`.trim()),
  ],
];

/**
 * What publishing would change, against the text it starts from: the published
 * revision, or the document a fork came from. Marked the way the page comparing
 * two copies marks them, since it is the same reading.
 */
export const Changes = ({ base, draft }: { base: SpecDraft; draft: SpecDraft }) => {
  const text = useMemo(
    () => diffMarkdown(base.content, draft.content),
    [base.content, draft.content],
  );

  const fields = FIELDS.map(([label, read]) => {
    const was = read(base);
    const now = read(draft);
    return {
      label,
      gone: was.filter((value) => !now.includes(value)),
      come: now.filter((value) => !was.includes(value)),
    };
  }).filter((field) => field.gone.length + field.come.length > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="diff-key-ins rounded-sm px-2 py-1">added</span>
        <span className="diff-key-del rounded-sm px-2 py-1">removed</span>
      </div>

      {fields.length > 0 && (
        <dl className="space-y-2">
          {fields.map((field) => (
            <div key={field.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <dt className={`${LABEL} w-24 shrink-0`}>{field.label}</dt>
              <dd className="flex min-w-0 flex-1 flex-wrap gap-2 font-serif text-[0.9375rem]">
                {field.gone.map((value) => (
                  <del key={`-${value}`} className="diff-key-del">
                    {value}
                  </del>
                ))}
                {field.come.map((value) => (
                  <ins key={`+${value}`} className="diff-key-ins">
                    {value}
                  </ins>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {text.changed ? (
        <div
          className="doc"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by the same pipeline as a page
          dangerouslySetInnerHTML={{ __html: text.html }}
        />
      ) : (
        <p className={NOTE}>The text itself is unchanged.</p>
      )}
    </div>
  );
};
