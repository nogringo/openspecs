import { useState } from "react";
import type { RelayResult } from "~/lib/publish";
import { RelayReport } from "./relay-results";

type State = "idle" | "sending" | "done" | "failed";

/**
 * Republishing needs no key: the event was signed by its author long ago, and
 * every relay checks that signature itself. So this asks for no account, keeps
 * no session, and works the same in a private window.
 */
export const Rebroadcast = ({
  eventUrl,
  relays,
  className = "rounded-sm border border-rule px-2 py-1 text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted",
}: {
  eventUrl: string;
  relays: string[];
  /** The face it wears, so the same button reads as a row inside a menu. */
  className?: string;
}) => {
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<RelayResult[]>([]);

  const send = async () => {
    setState("sending");
    setResults([]);
    try {
      const response = await fetch(eventUrl);
      if (!response.ok) throw new Error(`the event could not be read: ${response.status}`);
      const event = await response.json();
      const { publishTo } = await import("~/lib/publish");
      await publishTo(event, relays, (result) => setResults((answered) => [...answered, result]));
      setState("done");
    } catch {
      setState("failed");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        title={`Publish this event again to ${relays.length} relays`}
        className={className}
      >
        {state === "idle" ? "Rebroadcast" : state === "sending" ? "Sending" : "Rebroadcast again"}
      </button>

      {state === "failed" && (
        <p className="basis-full normal-case tracking-normal text-signal-closed">
          The event could not be read from this server, so nothing was sent.
        </p>
      )}

      {(state === "sending" || state === "done") && (
        <div className="basis-full">
          <RelayReport relays={relays} results={results} done={state === "done"} />
        </div>
      )}
    </>
  );
};
