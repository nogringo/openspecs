import type { NostrEvent } from "@openspecs/nostr";
import { useState } from "react";
import type { RelayResult } from "~/lib/publish";
import { RelayReport } from "./relay-results";

type State = "idle" | "sending" | "done" | "failed";

const read = async (url: string): Promise<NostrEvent> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the event could not be read: ${response.status}`);
  return response.json();
};

/**
 * Republishing needs no key: the event was signed by its author long ago, and
 * every relay checks that signature itself. So this asks for no account, keeps
 * no session, and works the same in a private window.
 */
export const Rebroadcast = ({
  event,
  relays,
  className = "rounded-sm border border-rule px-2 py-1 text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted",
}: {
  /** Where to read the event, or the event itself when the page already holds it. */
  event: string | NostrEvent;
  /** The relays, or a way to work them out when that needs a lookup. */
  relays: string[] | (() => Promise<string[]>);
  /** The face it wears, so the same button reads as a row inside a menu. */
  className?: string;
}) => {
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<RelayResult[]>([]);
  const [targets, setTargets] = useState<string[]>([]);

  const send = async () => {
    setState("sending");
    setResults([]);
    try {
      const signed = typeof event === "string" ? await read(event) : event;
      const chosen = Array.isArray(relays) ? relays : await relays();
      setTargets(chosen);
      const { publishTo } = await import("~/lib/publish");
      await publishTo(signed, chosen, (result) => setResults((answered) => [...answered, result]));
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
        title={
          Array.isArray(relays)
            ? `Publish this event again to ${relays.length} relays`
            : "Publish this event again"
        }
        className={className}
      >
        {state === "idle" ? "Rebroadcast" : state === "sending" ? "Sending" : "Rebroadcast again"}
      </button>

      {state === "failed" && (
        <p className="basis-full normal-case tracking-normal text-signal-closed">
          {typeof event === "string"
            ? "The event could not be read from this server, so nothing was sent."
            : "The relays could not be worked out, so nothing was sent."}
        </p>
      )}

      {(state === "sending" || state === "done") && (
        <div className="basis-full">
          <RelayReport relays={targets} results={results} done={state === "done"} />
        </div>
      )}
    </>
  );
};
