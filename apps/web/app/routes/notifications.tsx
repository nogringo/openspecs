import { useEffect, useState, useSyncExternalStore } from "react";
import { NoticeRow } from "~/components/notifications/notice-row";
import { Shell } from "~/components/shell";
import { PAGE_HEADERS } from "~/lib/http";
import {
  markNoticesSeen,
  noticesState,
  serverNoticesState,
  subscribeNoticesState,
} from "~/lib/notifications";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/notifications";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Notifications | Open Specs" },
    // Nothing here belongs to the site: it is one key's mail, read in one
    // browser, and what a crawler would index is the line asking it to connect.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * Everything addressed to the connected key. No loader, like the settings page
 * and for the same reason: it is asked for with the reader's key, in the
 * reader's browser, and the server has neither.
 *
 * The subscription itself belongs to the bell in the header, which is on this
 * page too and has been running since whichever page came before it.
 */
export default function NotificationsRoute() {
  useEffect(restoreSession, []);

  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const state = useSyncExternalStore(subscribeNoticesState, noticesState, serverNoticesState);

  /** The mark as it stood when this page was opened, so the rows stay marked. */
  const [shownFrom, setShownFrom] = useState<number | null>(null);
  useEffect(() => {
    if (state.me === null) return;
    setShownFrom((held) => held ?? state.seenAt);
    markNoticesSeen();
  }, [state.me, state.seenAt]);

  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);
  useEffect(() => {
    const keys = state.notices.map((notice) => notice.pubkey);
    if (keys.length > 0) wantAuthors(keys);
  }, [state.notices]);

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Notifications</h1>

        {session.pubkey === null ? (
          <p className="writing mt-6">
            Connect a key and this page fills with what was addressed to it: what people wrote,
            marked or paid on your documents, and who else signs their name to one.
          </p>
        ) : state.notices.length === 0 ? (
          <p className="writing mt-6">
            {state.status === "ready"
              ? "Nothing yet. This page stays empty until somebody answers something of yours."
              : "Asking the relays."}
          </p>
        ) : (
          <ul className="mt-6">
            {state.notices.map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                authors={authors}
                unread={notice.createdAt > (shownFrom ?? 0)}
              />
            ))}
          </ul>
        )}
      </main>
    </Shell>
  );
}
