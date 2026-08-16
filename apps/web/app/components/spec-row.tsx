import { Link } from "react-router";
import type { SpecCard } from "~/lib/specs.server";
import { Highlight } from "./highlight";
import { KeyMark } from "./key-mark";
import { SpecTags } from "./spec-tags";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

export const SpecRow = ({
  spec,
  excerpt,
  terms,
}: {
  spec: SpecCard;
  /** What a search found in the body, shown in place of the summary. */
  excerpt?: string;
  terms?: string[];
}) => {
  const line = excerpt || spec.summary;

  return (
    <li className="border-t border-rule">
      <Link to={spec.path} className="group block py-6">
        <div className="flex gap-4">
          <span className="mt-1 shrink-0">
            <KeyMark pubkey={spec.pubkey} size={28} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="min-w-0 font-mono text-base font-medium group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                <Highlight text={spec.title} terms={terms} />
              </h3>
              <time
                dateTime={new Date(spec.publishedAt * 1000).toISOString()}
                className="shrink-0 font-mono text-xs text-muted"
              >
                {asDate(spec.publishedAt)}
              </time>
            </div>
            {line !== "" && (
              <p className="mt-2 line-clamp-2 max-w-[44rem] font-serif text-muted">
                <Highlight text={line} terms={terms} />
              </p>
            )}
            <div className="mt-3">
              {/* Plain text, not links: a row is already one link, and nesting a second is invalid. */}
              <SpecTags status={spec.status} kinds={spec.kinds} topics={spec.topics} />
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
};
