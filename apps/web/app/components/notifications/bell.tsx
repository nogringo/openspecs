import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { CHROME, Panel } from "~/components/chrome";
import {
  alertPermission,
  alertsWanted,
  askToAlert,
  serverAlertsWanted,
  setAlertsWanted,
  subscribeAlerts,
} from "~/lib/alerts";
import {
  clearNotices,
  markNoticesSeen,
  noticesState,
  serverNoticesState,
  startNotices,
  subscribeNoticesState,
} from "~/lib/notifications";
import { notificationsPath } from "~/lib/paths";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import { NoticeRow } from "./notice-row";

/** As many as fit under a header without the panel becoming the page. */
const PANEL_ROWS = 8;

/** Past this the badge says there is a pile rather than how big the pile is. */
const MAX_BADGE = 99;

/** What this puts in front of a page title, and the only thing it takes back off. */
const BADGE = /^\(\d+\)\s/;

/**
 * The number in front of the tab's own name, while the tab is in the background,
 * which is the only time a title is the thing being read.
 *
 * A page title is set per route, by `meta`, on every navigation, so this cannot
 * set it once. It re-applies after each one, and it strips its own prefix before
 * writing, so that applying it twice says the same thing as applying it once and
 * `(3) (3) Open Specs` cannot happen however the two race.
 */
const useTabBadge = (unread: number): void => {
  const location = useLocation();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const watch = () => setHidden(document.visibilityState === "hidden");
    watch();
    document.addEventListener("visibilitychange", watch);
    return () => document.removeEventListener("visibilitychange", watch);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger, not a read
  useEffect(() => {
    const base = document.title.replace(BADGE, "");
    document.title = hidden && unread > 0 ? `(${unread}) ${base}` : base;
    return () => {
      document.title = document.title.replace(BADGE, "");
    };
  }, [unread, hidden, location.key]);
};

/**
 * One line, drawn only while the browser has neither been asked nor refused, and
 * only for somebody who has news to be told about. The permission itself is
 * asked from the click and nowhere else.
 */
const Offer = ({ onDone }: { onDone: () => void }) => {
  const [asking, setAsking] = useState(false);

  return (
    <div className="mt-3 border-t border-rule pt-3">
      <p className="font-serif text-[0.8125rem] leading-snug text-muted">
        This can knock while you are in another tab.
      </p>
      <button
        type="button"
        disabled={asking}
        className={`${CHROME} mt-2`}
        onClick={() => {
          setAsking(true);
          void askToAlert().then((answer) => {
            if (answer === "granted") setAlertsWanted(true);
            onDone();
          });
        }}
      >
        Let it
      </button>
    </div>
  );
};

const BellMark = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5v2.2c0 .5-.18.98-.5 1.36L3.2 9.4a.6.6 0 0 0 .46.98h8.68a.6.6 0 0 0 .46-.98l-.8-.84a2.1 2.1 0 0 1-.5-1.36V5A3.5 3.5 0 0 0 8 1.5Zm0 12.5a1.9 1.9 0 0 0 1.8-1.3H6.2A1.9 1.9 0 0 0 8 14Z" />
  </svg>
);

/**
 * The header's second control, beside the one that says who you are. It is drawn
 * only for a key, because there is no such thing as news addressed to nobody.
 *
 * The subscription is started here and never torn down here. The header is
 * rendered inside each route rather than in the root, so every navigation
 * unmounts this component and mounts it again: closing on unmount would pay for
 * the whole backfill on each page and blink the badge to nothing in between.
 * The store outlives the route, which is why it is a module and not a hook.
 */
export const Bell = () => {
  const [open, setOpen] = useState(false);
  /**
   * The mark as it stood when the panel was opened. Opening reads the news, so
   * the badge has to clear, but the rows must stay marked while they are being
   * looked at: clearing them under the eye is how a reader loses their place.
   */
  const [shownFrom, setShownFrom] = useState(0);

  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const state = useSyncExternalStore(subscribeNoticesState, noticesState, serverNoticesState);

  useEffect(() => {
    if (session.pubkey === null) clearNotices();
    else startNotices(session.pubkey);
  }, [session.pubkey]);

  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);
  useEffect(() => {
    // Only the rows the panel would draw. Asking about two hundred keys to put
    // a number on a bell is two hundred lookups nobody is going to read.
    const keys = state.notices.slice(0, PANEL_ROWS).map((notice) => notice.pubkey);
    if (keys.length > 0) wantAuthors(keys);
  }, [state.notices]);

  const wanted = useSyncExternalStore(subscribeAlerts, alertsWanted, serverAlertsWanted);
  const [permission, setPermission] = useState<string>("unsupported");
  useEffect(() => setPermission(alertPermission()), []);
  useTabBadge(state.unread);

  const rows = state.notices.slice(0, PANEL_ROWS);

  if (session.pubkey === null) return null;

  const toggle = () => {
    if (!open) {
      setShownFrom(state.seenAt);
      markNoticesSeen();
    }
    setOpen(!open);
  };

  const badge = state.unread > MAX_BADGE ? `${MAX_BADGE}+` : String(state.unread);

  return (
    <div className="relative flex shrink-0">
      <button
        type="button"
        onClick={toggle}
        title={state.unread === 0 ? "Notifications" : `${state.unread} unread`}
        // The height is stated rather than inherited from the glyph: the control
        // beside this one is as tall as the avatar in it, and two buttons on the
        // same line that miss each other by two pixels are what the eye catches.
        className={`${CHROME} inline-flex h-7 items-center gap-1.5`}
      >
        <BellMark />
        {state.unread > 0 && <span className="tracking-normal">{badge}</span>}
        <span className="sr-only">Notifications</span>
      </button>

      {open && (
        <Panel width="w-[min(28rem,calc(100vw-2rem))]">
          {rows.length === 0 ? (
            <p className="font-serif text-[0.9375rem] leading-relaxed text-muted">
              {state.status === "ready"
                ? "Nothing yet. What people write, mark or pay on your documents lands here."
                : "Asking the relays."}
            </p>
          ) : (
            // Bounded, and scrolled past that: eight rows of somebody with a busy
            // week is a panel taller than the screen it hangs off, which is a
            // page rather than a glance at one.
            //
            // The negative margin is what puts the scrollbar against the panel's
            // border. Left inside the panel's padding it stands in open paper,
            // sixteen pixels short of the edge, which reads as a bar somebody
            // dropped on the page rather than as the side of a box.
            <ul className="-mt-2 -mr-4 max-h-[60vh] overflow-y-auto pr-4 [scrollbar-width:thin]">
              {rows.map((notice) => (
                <NoticeRow
                  key={notice.id}
                  notice={notice}
                  authors={authors}
                  unread={notice.createdAt > shownFrom}
                  onFollowed={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
          {!wanted && permission === "default" && rows.length > 0 && (
            <Offer onDone={() => setPermission(alertPermission())} />
          )}

          {/* Outside the branch above: a panel with nothing in it is still the
              only way to the page, and a box that leads nowhere is a dead end. */}
          <div className="mt-3 border-t border-rule pt-3">
            <Link to={notificationsPath()} className={CHROME} onClick={() => setOpen(false)}>
              Everything
            </Link>
          </div>
        </Panel>
      )}
    </div>
  );
};
