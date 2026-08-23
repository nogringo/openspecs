import type { SpecKindRef } from "@openspecs/nostr";
import { Link } from "react-router";
import { specsPath } from "~/lib/paths";

/**
 * Status is a free string, so this maps the values documents actually use onto
 * three states and leaves anything else neutral rather than guessing.
 */
export const STATUS_TONE: Record<string, string> = {
  draft: "text-signal-open",
  proposal: "text-signal-open",
  proposed: "text-signal-open",
  experimental: "text-signal-open",
  wip: "text-signal-open",
  accepted: "text-signal-settled",
  active: "text-signal-settled",
  final: "text-signal-settled",
  stable: "text-signal-settled",
  deprecated: "text-signal-closed",
  unrecommended: "text-signal-closed",
  obsolete: "text-signal-closed",
  rejected: "text-signal-closed",
  retired: "text-signal-closed",
  withdrawn: "text-signal-closed",
};

export type SpecTagsProps = {
  status: string | null;
  kinds: SpecKindRef[];
  topics: string[];
  /** Turns kinds and topics into links to the listing they filter. */
  linked?: boolean;
};

export const SpecTags = ({ status, kinds, topics, linked = false }: SpecTagsProps) => {
  if (status === null && kinds.length === 0 && topics.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
      {status !== null && (
        <span className={STATUS_TONE[status.toLowerCase()] ?? "text-muted"}>{status}</span>
      )}
      {kinds.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted">covers</span>
          {kinds.map((kind) => (
            <span key={kind.raw}>
              {/* Only a numeric kind is a filter relays can answer. */}
              {linked && kind.kind !== null ? (
                <Link to={specsPath({ kind: kind.kind })} className="hover:underline">
                  {kind.raw}
                </Link>
              ) : (
                kind.raw
              )}
              {kind.name !== null && <span className="text-muted"> {kind.name}</span>}
            </span>
          ))}
        </span>
      )}
      {topics.map((topic) =>
        linked ? (
          <Link key={topic} to={specsPath({ topic })} className="text-muted hover:text-ink">
            #{topic}
          </Link>
        ) : (
          <span key={topic} className="text-muted">
            #{topic}
          </span>
        ),
      )}
    </div>
  );
};
