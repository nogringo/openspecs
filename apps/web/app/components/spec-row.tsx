import { Link } from "react-router";
import type { Author } from "~/lib/profile";
import type { SpecCard } from "~/lib/specs.server";
import { AuthorAvatar } from "./author-avatar";
import { Highlight } from "./highlight";
import { SpecTags } from "./spec-tags";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

export const SpecRow = ({
  spec,
  author,
  avatar = true,
  excerpt,
  terms,
}: {
  spec: SpecCard;
  /**
   * Only the picture is taken: a name arriving after the row would push the rest
   * of it down, and a list that jumps under the eye is worse than a list of marks.
   */
  author?: Author | null;
  /** Off where every row is signed by the same key, which the page already names. */
  avatar?: boolean;
  /** What a search found in the body, shown in place of the summary. */
  excerpt?: string;
  terms?: string[];
}) => {
  const line = excerpt || spec.summary;

  return (
    <li className="border-t border-rule">
      <Link to={spec.path} className="group block py-6">
        <div className="flex gap-4">
          {avatar && (
            <span className="mt-1 shrink-0">
              <AuthorAvatar pubkey={spec.pubkey} picture={author?.picture ?? null} size={28} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="min-w-0 font-mono text-base font-medium group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                <Highlight text={spec.title} terms={terms} />
              </h3>
              <time
                dateTime={new Date(spec.revisedAt * 1000).toISOString()}
                className="shrink-0 font-mono text-xs text-muted"
              >
                {asDate(spec.revisedAt)}
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
