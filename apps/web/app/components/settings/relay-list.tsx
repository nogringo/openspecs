import {
  buildRelayList,
  MAX_RELAYS_PER_AUTHOR,
  parseRelayEntries,
  type RelayEntry,
  relayUrl,
} from "@openspecs/nostr";
import { useState } from "react";
import { RelayReport } from "~/components/relay-results";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { relayListRelays } from "~/lib/relays";

type State = "editing" | "sending" | "sent" | "failed";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

const hostOf = (relay: string): string => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");

/**
 * Behind a disclosure, closed, and last on the page. Somebody who came to fix
 * their name should not have to walk past a list of servers to reach it, and
 * this is already set up and working for everybody who never opens it.
 *
 * The markers NIP-65 allows are never drawn. Most lists carry none, the two of
 * them are a distinction almost nobody wants to make, and a relay that arrived
 * with one keeps it: this page does not get to quietly change what it chose not
 * to show.
 */
export const RelayList = ({
  me,
  published,
  missing,
  onSaved,
}: {
  me: string;
  published: RelayEntry[];
  /** Nothing came back for this key, which is not the same as it having nothing. */
  missing: boolean;
  onSaved: (entries: RelayEntry[]) => void;
}) => {
  const [entries, setEntries] = useState<RelayEntry[]>(published);
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [state, setState] = useState<State>("editing");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const changed = JSON.stringify(entries) !== JSON.stringify(published);

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const url = relayUrl(adding);
    if (url === null) {
      setAddError("That does not read as a relay address.");
      return;
    }
    if (entries.some((entry) => entry.url === url)) {
      setAddError("That one is already on the list.");
      return;
    }

    // No marker: a relay named here is one to publish to and be reached at, and
    // that is what an `r` tag with nothing after it means.
    setEntries([...entries, { url }]);
    setAdding("");
    setAddError(null);
    setState("editing");
  };

  const remove = (url: string) => {
    setEntries(entries.filter((entry) => entry.url !== url));
    setState("editing");
  };

  const save = async () => {
    setState("sending");
    setResults([]);
    setError(null);
    try {
      // The relays being left hear it too, or a client reading the old list from
      // one of them keeps sending this key's readers where it no longer writes.
      const targets = relayListRelays(
        me,
        entries.map((entry) => entry.url),
      );
      targets.then(setRelays).catch(() => {});

      const report = await signAndPublish(buildRelayList(entries), targets, (result) =>
        setResults((answered) => [...answered, result]),
      );

      if (report.accepted === 0) {
        setState("failed");
        setError("No relay took it. Nothing was published, and your list is unchanged.");
        return;
      }

      // Read back out of the event, so the list on screen is the list published.
      const saved = parseRelayEntries(report.event) ?? entries;
      setEntries(saved);
      onSaved(saved);
      setState("sent");
    } catch (reason) {
      setState("failed");
      setError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  return (
    <details className="group">
      <summary className="cursor-pointer font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink">
        Your relays
        <span className="ml-3 normal-case tracking-normal">
          {entries.length === 1 ? "1 relay" : `${entries.length} relays`}
        </span>
      </summary>

      <div className="mt-5 space-y-5">
        <p className={NOTE}>
          Relays are servers, and these are yours: they hold what you write, and they are where
          anyone answering you sends it. They are set up and working. Changing them is worth doing
          when you run your own, or when one of these stops answering.
        </p>

        {missing && (
          <p className={WRONG}>
            Nothing came back for this key. Either it has named no relays yet, or none answered just
            now. Saving writes a new list over anything that was there.
          </p>
        )}

        {entries.length > 0 && (
          <ul className="divide-y divide-rule border-y border-rule">
            {entries.map((entry) => (
              <li key={entry.url} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate font-mono text-xs">{hostOf(entry.url)}</span>
                <button
                  type="button"
                  onClick={() => remove(entry.url)}
                  className="shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-signal-closed"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="space-y-2" onSubmit={add}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${FIELD} max-w-xs`}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              placeholder="relay.example.com"
              inputMode="url"
              spellCheck={false}
              aria-label="A relay to add"
            />
            <button type="submit" className={ACTION} disabled={adding.trim() === ""}>
              Add
            </button>
          </div>
          {addError !== null && <p className={WRONG}>{addError}</p>}
        </form>

        {entries.length === 0 && (
          <p className={WRONG}>
            A list with no relays leaves your documents with nowhere to be looked for, and anyone
            answering you with nowhere to send it.
          </p>
        )}

        {entries.length > MAX_RELAYS_PER_AUTHOR && (
          <p className={NOTE}>
            Most clients read the first {MAX_RELAYS_PER_AUTHOR} and stop, this one included, so the
            ones below that are named for nobody.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={ACTION}
            onClick={() => void save()}
            disabled={!changed || state === "sending"}
          >
            {state === "sending" ? "Saving" : "Save relays"}
          </button>
          {!changed && state !== "sent" && <p className={NOTE}>Nothing to save yet.</p>}
          {state === "sent" && !changed && <p className={NOTE}>Saved.</p>}
        </div>

        {(state === "sending" || state === "sent") && relays.length > 0 && (
          <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
            <RelayReport relays={relays} results={results} done={state === "sent"} />
          </div>
        )}

        {error !== null && <p className={WRONG}>{error}</p>}
      </div>
    </details>
  );
};
