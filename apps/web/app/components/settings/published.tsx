import { useCallback, useEffect, useState } from "react";
import { Unlock } from "~/components/unlock";
import { identityRelays } from "~/lib/relays";
import type { Own } from "~/routes/settings";

export type Reading = "reading" | "read" | "failed";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

/**
 * Reads back whole what a key has published, before any of it is offered for
 * editing.
 *
 * Each of these is a single replaceable event, so a save replaces the lot, and a
 * form that started empty would publish an empty one over a full one. That read
 * is also why none of these pages has a loader: it is asked for with the
 * reader's key, in the reader's browser, and the server has neither.
 *
 * `read` is called with the key and the relays to look on, so it can be declared
 * outside the component and stay the same callback between renders.
 */
export const usePublished = <T,>(own: Own, read: (me: string, relays: string[]) => Promise<T>) => {
  const [state, setState] = useState<Reading>("reading");
  const [value, setValue] = useState<T | null>(null);
  const { me, locked } = own;

  // The effect itself, so that trying again is running it again rather than
  // nudging a counter it happens to depend on.
  const load = useCallback(() => {
    if (me === null || locked) return;

    let live = true;
    setState("reading");

    (async () => {
      try {
        const relays = await identityRelays(me);
        const got = await read(me, relays);
        if (!live) return;
        setValue(got);
        setState("read");
      } catch {
        if (live) setState("failed");
      }
    })();

    // A key swapped in the header while this page is open must not have the
    // previous one's answer arrive on top of it a second later.
    return () => {
      live = false;
    };
  }, [me, locked, read]);

  useEffect(load, [load]);

  return { state, value, setValue, again: load };
};

/**
 * Everything standing between a reader and their own published settings: no key,
 * a shut one, a read still running, and a read that failed.
 */
export const Gate = <T,>({
  own,
  state,
  value,
  again,
  connect,
  children,
}: {
  own: Own;
  state: Reading;
  value: T | null;
  again: () => void;
  /** What is behind this gate, said in the words of the tab asking for it. */
  connect: string;
  /** Called only once there is a key, and a revision of its own to edit. */
  children: (ready: { me: string; npub: string; value: T }) => React.ReactNode;
}) => {
  if (own.me === null || own.npub === null) return <p className={NOTE}>{connect}</p>;

  if (own.locked)
    return (
      <div className="max-w-sm">
        <Unlock />
      </div>
    );

  if (state === "failed")
    return (
      <div className="space-y-3">
        {/* No form until the live revision is in hand. Saving something this page
            never managed to read would replace it with what these fields happen
            to hold and delete everything else it carried. */}
        <p className="font-serif text-[0.9375rem] leading-relaxed text-signal-closed">
          Could not read what this key published, so there is nothing safe to edit yet. Saving from
          here would write over something nobody has seen.
        </p>
        <button type="button" className={ACTION} onClick={again}>
          Try again
        </button>
      </div>
    );

  if (state !== "read" || value === null)
    return <p className={NOTE}>Reading what this key has published.</p>;

  return <>{children({ me: own.me, npub: own.npub, value })}</>;
};
