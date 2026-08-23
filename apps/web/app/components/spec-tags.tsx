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

/** Past this a run of kinds stops reading as a line of metadata and becomes a wall. */
const INDEX_ABOVE = 12;

/** Only a numeric kind is a filter relays can answer. */
const Filter = ({
  kind,
  linked,
  className,
  children,
}: {
  kind: SpecKindRef;
  linked: boolean;
  className: string;
  children: React.ReactNode;
}) =>
  linked && kind.kind !== null ? (
    <Link to={specsPath({ kind: kind.kind })} className={`hover:underline ${className}`}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );

/**
 * The number is what a relay answers to and the name only glosses it, so the two
 * are set in different registers. Without that a long run is one stream of
 * capitals with nothing in it for the eye to hold on to.
 */
const Name = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`normal-case tracking-normal text-muted ${className}`}>{name}</span>
);

/** The gap inside an entry is a quarter of the gap between them: that is what says where one kind ends. */
const KindRun = ({
  kinds,
  linked,
  rest,
}: {
  kinds: SpecKindRef[];
  linked: boolean;
  rest: number;
}) => (
  <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
    <span className="text-muted">covers</span>
    {kinds.map((kind) => (
      <Filter key={kind.raw} kind={kind} linked={linked} className="">
        {kind.raw}
        {kind.name !== null && <Name name={kind.name} className="ml-1.5" />}
      </Filter>
    ))}
    {rest > 0 && <span className="text-muted">+{rest} more</span>}
  </span>
);

/**
 * A document can cover sixty kinds, and then the list is reference material
 * rather than a label: it is closed, and open it is an index, one kind a line
 * with the numbers on a column. Rendered whole either way, so a crawler reading
 * the markup sees every kind the author claimed.
 */
const KindIndex = ({ kinds }: { kinds: SpecKindRef[] }) => (
  <details className="group">
    <summary className="inline-flex cursor-pointer list-none items-baseline gap-x-2 text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
      <span>
        covers <span className="text-ink">{kinds.length}</span> event kinds
      </span>
      <span aria-hidden="true" className="group-open:hidden">
        +
      </span>
      <span aria-hidden="true" className="hidden group-open:inline">
        -
      </span>
    </summary>
    <ul className="mt-4 columns-1 gap-x-8 sm:columns-2">
      {kinds.map((kind) => (
        <li key={kind.raw} className="break-inside-avoid py-0.5">
          <Filter
            kind={kind}
            linked
            className="grid grid-cols-[3.5rem_minmax(0,1fr)] leading-relaxed"
          >
            <span>{kind.raw}</span>
            {kind.name !== null && <Name name={kind.name} />}
          </Filter>
        </li>
      ))}
    </ul>
  </details>
);

export type SpecTagsProps = {
  status: string | null;
  kinds: SpecKindRef[];
  topics: string[];
  /** Turns kinds and topics into links to the listing they filter. */
  linked?: boolean;
  /** Keeps a listing row scannable: past this many kinds the rest is a count. */
  max?: number;
};

export const SpecTags = ({ status, kinds, topics, linked = false, max }: SpecTagsProps) => {
  if (status === null && kinds.length === 0 && topics.length === 0) return null;

  const shown = max === undefined ? kinds : kinds.slice(0, max);
  // A capped list belongs to a row, which nests this inside its own link and so
  // can take neither a disclosure nor the links an index is made of.
  const indexed = max === undefined && kinds.length > INDEX_ABOVE;
  const hasLine = status !== null || topics.length > 0 || (!indexed && kinds.length > 0);

  return (
    <div className="flex flex-col gap-y-4 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
      {hasLine && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {status !== null && (
            <span className={STATUS_TONE[status.toLowerCase()] ?? "text-muted"}>{status}</span>
          )}
          {!indexed && kinds.length > 0 && (
            <KindRun kinds={shown} linked={linked} rest={kinds.length - shown.length} />
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
      )}
      {indexed && <KindIndex kinds={kinds} />}
    </div>
  );
};
