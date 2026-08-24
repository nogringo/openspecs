import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type AlertPermission,
  alertPermission,
  alertsWanted,
  askToAlert,
  serverAlertsWanted,
  setAlertsWanted,
  subscribeAlerts,
} from "~/lib/alerts";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const ACTION =
  "shrink-0 rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink aria-checked:border-muted aria-checked:text-ink";

/**
 * Whether the browser knocks when something arrives while you are elsewhere.
 *
 * The permission is asked for here, from a click, and never on a page load: the
 * answer can only be given once, and a page that asks the moment it opens is
 * asking before it has anything to say. A browser that has refused is not asked
 * again, since it would not show the prompt: the line below says where to change
 * its mind instead.
 */
export const Alerts = () => {
  const wanted = useSyncExternalStore(subscribeAlerts, alertsWanted, serverAlertsWanted);
  const [permission, setPermission] = useState<AlertPermission>("unsupported");
  useEffect(() => setPermission(alertPermission()), []);

  const turn = async (on: boolean) => {
    if (!on) {
      setAlertsWanted(false);
      return;
    }
    const answer = await askToAlert();
    setPermission(answer);
    if (answer === "granted") setAlertsWanted(true);
  };

  const on = wanted && permission === "granted";

  return (
    <section className="space-y-5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
        Being told
      </h2>

      <div className="flex items-center justify-between gap-4">
        <span id="alerts-label" className="font-mono text-xs text-ink">
          Knock when something arrives
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="alerts-label"
          disabled={permission === "unsupported"}
          onClick={() => void turn(!on)}
          className={ACTION}
        >
          {on ? "On" : "Off"}
        </button>
      </div>

      <p className={NOTE}>
        It's like leaving the door on the latch. On, and the browser taps you on the shoulder when
        somebody answers something of yours while you are looking at another tab, at most once every
        half minute, and what came in between is counted rather than repeated. Off, and the bell in
        the corner waits for you to look at it. Nothing leaves this browser either way: it is
        reading the relays and telling you, not a server keeping a list of you.
      </p>

      {permission === "denied" && (
        <p className={NOTE}>
          This browser is refusing them and will not ask again. Its own settings for this site are
          the only place left to change that.
        </p>
      )}
      {permission === "unsupported" && (
        <p className={NOTE}>This browser does not do that sort of knocking.</p>
      )}
    </section>
  );
};
