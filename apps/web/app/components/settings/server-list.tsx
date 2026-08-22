import {
  buildServerList,
  DEFAULT_BLOSSOM_SERVERS,
  parseServerList,
  serverOrigin,
  serverSet,
} from "@openspecs/nostr";
import { useState } from "react";
import { RelayReport } from "~/components/relay-results";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { identityRelays } from "~/lib/relays";

type State = "editing" | "sending" | "sent" | "failed";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

/** Dashed, because these are addresses on offer rather than anything of this key's yet. */
const SUGGESTION =
  "rounded-sm border border-dashed border-rule px-2 py-1 font-mono text-[0.6875rem] text-muted hover:border-muted hover:text-ink";

const host = (server: string): string => server.replace(/^https:\/\//, "");

/**
 * The servers a picture is copied onto, and the list a client with a dead
 * address walks to find the copies. Folded away beside the relays, and for the
 * same reason: somebody changing their name has no business being shown this,
 * and it is filled in by uploading a picture without anybody opening it.
 *
 * The order is meaningful, which is the one thing this says out loud: BUD-03
 * asks for most trusted first, and the first is where an upload lands and where
 * every copy is fetched from.
 */
export const ServerList = ({
  me,
  published,
  missing,
  onSaved,
}: {
  me: string;
  published: string[];
  /** Nothing came back for this key, which is not the same as it having nothing. */
  missing: boolean;
  onSaved: (servers: string[]) => void;
}) => {
  const [servers, setServers] = useState<string[]>(published);
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [state, setState] = useState<State>("editing");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const changed = JSON.stringify(servers) !== JSON.stringify(published);

  const suggestions = serverSet(DEFAULT_BLOSSOM_SERVERS).filter(
    (origin) => !servers.includes(origin),
  );

  const include = (origin: string) => {
    setServers([...servers, origin]);
    setAddError(null);
    setState("editing");
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const origin = serverOrigin(adding);
    if (origin === null) {
      setAddError("That does not read as an https address.");
      return;
    }
    if (servers.includes(origin)) {
      setAddError("That one is already on the list.");
      return;
    }

    include(origin);
    setAdding("");
  };

  const remove = (origin: string) => {
    setServers(servers.filter((server) => server !== origin));
    setState("editing");
  };

  const save = async () => {
    setState("sending");
    setResults([]);
    setError(null);
    try {
      const targets = identityRelays(me);
      targets.then(setRelays).catch(() => {});

      const report = await signAndPublish(buildServerList(servers), targets, (result) =>
        setResults((answered) => [...answered, result]),
      );

      if (report.accepted === 0) {
        setState("failed");
        setError("No relay took it. Nothing was published, and your list is unchanged.");
        return;
      }

      const saved = parseServerList(report.event) ?? servers;
      setServers(saved);
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
        Where your pictures are kept
        <span className="ml-3 normal-case tracking-normal">
          {servers.length === 1 ? "1 server" : `${servers.length} servers`}
        </span>
      </summary>

      <div className="mt-5 space-y-5">
        <p className={NOTE}>
          A picture you upload is put on every one of these, and any of them can serve it back. This
          is filled in for you the first time you upload one, and the servers here are public ones
          run by other people. Naming your own puts your pictures somewhere you decide.
        </p>

        {missing && (
          <p className={WRONG}>
            Nothing came back for this key. Either it has named no servers yet, or no relay answered
            just now. Saving writes a new list over anything that was there.
          </p>
        )}

        {servers.length > 0 && (
          <ul className="divide-y divide-rule border-y border-rule">
            {servers.map((server, index) => (
              <li key={server} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate font-mono text-xs">
                  {host(server)}
                  {index === 0 && (
                    <span className="ml-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
                      uploaded here first
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => remove(server)}
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
              placeholder="blossom.example.com"
              inputMode="url"
              spellCheck={false}
              aria-label="A server to add"
            />
            <button type="submit" className={ACTION} disabled={adding.trim() === ""}>
              Add
            </button>
          </div>
          {addError !== null && <p className={WRONG}>{addError}</p>}

          {/* Where a picture goes when nothing is named, so a list filled in from
              here holds what the site would have used anyway. An addition lands
              last, which leaves a server named above it as the upload target. */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {suggestions.map((origin) => (
                <button
                  key={origin}
                  type="button"
                  className={SUGGESTION}
                  onClick={() => include(origin)}
                  aria-label={`Add ${host(origin)}`}
                >
                  + {host(origin)}
                </button>
              ))}
            </div>
          )}
        </form>

        {servers.length === 0 && (
          <p className={NOTE}>
            With none named, a picture goes to the servers this site knows and they are named for
            you afterwards.
          </p>
        )}

        {servers.length === 1 && (
          <p className={WRONG}>
            One server is one outage away from a profile with a hole in it. Name a second and every
            picture you upload is put on both.
          </p>
        )}

        {servers.length > 6 && (
          <p className={NOTE}>
            Every picture is put on all of them, so a list this long makes uploading one slow.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={ACTION}
            onClick={() => void save()}
            disabled={!changed || state === "sending"}
          >
            {state === "sending" ? "Saving" : "Save servers"}
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
