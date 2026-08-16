import { useState } from "react";
import type { RelayResult } from "~/lib/rebroadcast";

type State = "idle" | "sending" | "done" | "failed";

const hostOf = (relay: string): string => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");

/**
 * One square per relay, filled as its answer arrives. The same blocks the key
 * marks are drawn with, and the whole report on one line rather than fourteen:
 * a reader wants to know whether the document travelled, not to read a list of
 * hostnames they never chose.
 */
const Squares = ({ relays, results }: { relays: string[]; results: RelayResult[] }) => (
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
 * Republishing needs no key: the event was signed by its author long ago, and
 * every relay checks that signature itself. So this asks for no account, keeps
 * no session, and works the same in a private window.
 */
export const Rebroadcast = ({ eventUrl, relays }: { eventUrl: string; relays: string[] }) => {
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<RelayResult[]>([]);

  const send = async () => {
    setState("sending");
    setResults([]);
    try {
      const response = await fetch(eventUrl);
      if (!response.ok) throw new Error(`the event could not be read: ${response.status}`);
      const event = await response.json();
      const { rebroadcast } = await import("~/lib/rebroadcast");
      await rebroadcast(event, relays, (result) => setResults((answered) => [...answered, result]));
      setState("done");
    } catch {
      setState("failed");
    }
  };

  const accepted = results.filter((result) => result.accepted);
  const refused = results.filter((result) => !result.accepted);

  return (
    <>
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        title={`Publish this event again to ${relays.length} relays`}
        className="rounded-sm border border-rule px-2 py-1 text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted"
      >
        {state === "idle" ? "Rebroadcast" : state === "sending" ? "Sending" : "Rebroadcast again"}
      </button>

      {state === "failed" && (
        <p className="basis-full normal-case tracking-normal text-signal-closed">
          The event could not be read from this server, so nothing was sent.
        </p>
      )}

      {(state === "sending" || state === "done") && (
        <div className="basis-full space-y-2">
          <Squares relays={relays} results={results} />
          <p aria-live="polite" className="text-muted">
            {state === "sending"
              ? `${results.length} of ${relays.length} relays answered`
              : `Accepted by ${accepted.length} of ${relays.length} relays`}
          </p>

          {/* The refusals are the only part worth reading, and only if asked for. */}
          {state === "done" && refused.length > 0 && (
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
      )}
    </>
  );
};
