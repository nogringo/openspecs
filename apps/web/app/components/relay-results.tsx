import type { RelayResult } from "~/lib/publish";

const hostOf = (relay: string): string => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");

/**
 * One square per relay, filled as its answer arrives. The same blocks the key
 * marks are drawn with, and the whole report on one line rather than fourteen:
 * a reader wants to know whether what they sent travelled, not to read a list of
 * hostnames they never chose.
 */
export const Squares = ({ relays, results }: { relays: string[]; results: RelayResult[] }) => (
  <div className="flex flex-wrap gap-1" aria-hidden="true">
    {relays.map((relay) => {
      const result = results.find((answered) => answered.relay === relay);
      const tone =
        result === undefined
          ? "bg-rule"
          : result.accepted
            ? "bg-signal-settled"
            : "bg-signal-closed";
      return (
        <span
          key={relay}
          title={`${hostOf(relay)}${result === undefined ? "" : `: ${result.message}`}`}
          className={`h-2.5 w-2.5 rounded-[1px] ${tone}`}
        />
      );
    })}
  </div>
);

/**
 * What every write in this app reports with, so publishing a comment says what
 * it did in the same words as republishing a document. The refusals are the only
 * part worth reading, and only if asked for.
 */
export const RelayReport = ({
  relays,
  results,
  done,
}: {
  relays: string[];
  results: RelayResult[];
  done: boolean;
}) => {
  const accepted = results.filter((result) => result.accepted);
  const refused = results.filter((result) => !result.accepted);

  return (
    <div className="space-y-2">
      <Squares relays={relays} results={results} />
      <p aria-live="polite" className="text-muted">
        {done
          ? `Accepted by ${accepted.length} of ${relays.length} relays`
          : `${results.length} of ${relays.length} relays answered`}
      </p>

      {done && refused.length > 0 && (
        <details className="normal-case tracking-normal text-muted">
          <summary className="cursor-pointer uppercase tracking-[0.14em] hover:text-ink">
            {refused.length} refused
          </summary>
          <ul className="mt-2 space-y-1">
            {refused.map((result) => (
              <li key={result.relay} className="flex flex-wrap gap-x-3">
                <span className="min-w-44">{hostOf(result.relay)}</span>
                <span>{result.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
