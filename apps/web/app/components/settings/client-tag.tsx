import { useSyncExternalStore } from "react";
import {
  namesClient,
  serverNamesClient,
  setNamesClient,
  subscribeClientTag,
} from "~/lib/client-tag";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const ACTION =
  "shrink-0 rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink aria-checked:border-muted aria-checked:text-ink";

/**
 * Whether what this key signs says which app signed it. A browser setting rather
 * than a published one, so it is here whether or not a key is connected and
 * whether or not this page managed to read what that key published: nothing
 * about it depends on either.
 */
export const ClientTag = () => {
  const on = useSyncExternalStore(subscribeClientTag, namesClient, serverNamesClient);

  return (
    <section className="space-y-5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
        Naming this app
      </h2>

      <div className="flex items-center justify-between gap-4">
        <span id="client-tag-label" className="font-mono text-xs text-ink">
          Name this app on what you sign
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="client-tag-label"
          onClick={() => setNamesClient(!on)}
          className={ACTION}
        >
          {on ? "On" : "Off"}
        </button>
      </div>

      <p className={NOTE}>
        It's like wearing a shirt with a logo on it. On, and everything you sign carries the name of
        this app, beside your key, on the relays, for good. Off, and it does not. Neither hides you:
        the people who know you recognise your walk.
      </p>
    </section>
  );
};
