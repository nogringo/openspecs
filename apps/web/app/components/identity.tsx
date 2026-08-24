import { toNpub } from "@openspecs/nostr";
import { useEffect, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { keyTextColor } from "~/lib/color";
import {
  closePanel,
  closePanels,
  panelState,
  serverPanelState,
  subscribePanels,
  togglePanel,
} from "~/lib/panels";
import { connectPath, newSpecPath, settingsPath } from "~/lib/paths";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import {
  logout,
  restoreSession,
  serverSessionState,
  sessionNsec,
  sessionState,
  subscribeSession,
} from "~/lib/session";
import { AuthorAvatar } from "./author-avatar";
import { CHROME, Panel } from "./chrome";
import { CopyButton } from "./copy-button";
import { Unlock } from "./unlock";

/**
 * The header's own control. The server renders it signed out, because the server
 * knows nobody, and it changes one tick after the page becomes interactive. The
 * width that keeps the rest of the line still while it does is reserved around
 * this and the bell together, in `Shell`, rather than around this alone.
 *
 * Signed out it is a link rather than a button: the ways in live at `/connect`,
 * where there is room for what they ask and where a stray click costs nothing.
 * What it leaves behind is a panel that is only a menu.
 */
export const Identity = () => {
  const open = useSyncExternalStore(subscribePanels, panelState, serverPanelState) === "identity";
  useEffect(restoreSession, []);
  useEffect(() => () => closePanel("identity"), []);
  const location = useLocation();

  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const npub = session.pubkey === null ? null : toNpub(session.pubkey);

  // The reader's own face and name, asked for the way every other one on the
  // page is: a key is who they are, a profile is what they call themselves.
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);
  useEffect(() => {
    if (session.pubkey !== null) wantAuthors([session.pubkey]);
  }, [session.pubkey]);
  const me = session.pubkey === null ? null : (authors[session.pubkey] ?? null);

  // Null unless a key is on this device and open, which is the only session
  // whose key exists nowhere else and can be lost by disconnecting.
  const nsec = session.pubkey === null ? null : sessionNsec();

  if (session.pubkey === null || npub === null) {
    return (
      <div className="flex shrink-0">
        {/* Where they are now, so the page they were reading is what they come
            back to rather than the front of the site. */}
        <Link to={connectPath(`${location.pathname}${location.search}`)} className={CHROME}>
          Connect
        </Link>
      </div>
    );
  }

  return (
    <div data-panel="identity" className="relative flex shrink-0">
      <button
        type="button"
        title={npub}
        onClick={() => togglePanel("identity")}
        className="flex items-center gap-2 rounded-sm border border-rule px-1.5 py-1 hover:border-muted"
      >
        <AuthorAvatar pubkey={session.pubkey} picture={me?.picture ?? null} size={18} />
        {/* A narrow screen has room for a face and not for a name. */}
        <span
          style={{ color: keyTextColor(session.pubkey) }}
          className="hidden max-w-32 truncate font-mono text-[0.6875rem] normal-case tracking-normal sm:block"
        >
          {authorName(me, npub)}
        </span>
      </button>

      {open && (
        <Panel>
          <div className="space-y-3">
            {/* One field, and wanted here rather than at `/connect`: a locked key
                is usually met in the middle of something, and a page that opens
                it by navigating away takes that something with it. */}
            {session.status === "locked" && session.method === "key" ? (
              <Unlock onDone={closePanels} />
            ) : (
              <div className="flex items-start gap-3">
                <AuthorAvatar pubkey={session.pubkey} picture={me?.picture ?? null} size={32} />
                <div className="min-w-0">
                  {me?.name && (
                    <p
                      style={{ color: keyTextColor(session.pubkey) }}
                      className="truncate font-mono text-xs"
                    >
                      {me.name}
                    </p>
                  )}
                  {/* The key stays under whatever they call themselves. */}
                  <p className="mt-1 break-all font-mono text-[0.6875rem] text-muted">{npub}</p>
                </div>
              </div>
            )}

            {/* A remote signer asking its owner to approve, in a tab they open. */}
            {session.authUrl !== null && (
              <a
                href={session.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block font-mono text-[0.6875rem] uppercase tracking-[0.14em] underline decoration-rule underline-offset-2 hover:decoration-current"
              >
                Approve in your signer
              </a>
            )}

            {session.error !== null && (
              <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">
                {session.error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {/* The only way in, so it is named for where it goes rather than
                  for the first thing waiting there. */}
              <Link to={newSpecPath()} className={CHROME} onClick={closePanels}>
                Write
              </Link>
              <Link to={settingsPath()} className={CHROME} onClick={closePanels}>
                Settings
              </Link>
              {/* Offered because disconnecting forgets it, and a key made here
                  may exist nowhere else at all. Named for which of the two keys
                  it is: the other one is on screen right above it. */}
              {nsec !== null && (
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
                  <CopyButton
                    value={nsec}
                    label="Copy your private key"
                    title="Your private key, the nsec, not the npub above"
                  />
                </span>
              )}
              <button
                type="button"
                className={CHROME}
                title={
                  nsec === null
                    ? undefined
                    : "Forgets this key on this device. Copy it first if this is the only copy."
                }
                onClick={() => {
                  closePanels();
                  void logout();
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
};
