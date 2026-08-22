import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { specEditPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";

const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

/**
 * Offered only to the key that signed the document, so it renders nothing at all
 * on the server and appears a tick after the session is restored. The row it
 * sits in already wraps, so arriving late moves nothing.
 */
export const EditLink = ({
  pubkey,
  npub,
  identifier,
}: {
  pubkey: string;
  npub: string;
  identifier: string;
}) => {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);

  if (session.pubkey !== pubkey) return null;

  return (
    <Link to={specEditPath(npub, identifier)} className={CHROME}>
      Edit
    </Link>
  );
};
