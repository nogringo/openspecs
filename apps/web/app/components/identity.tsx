import { toNpub } from "@openspecs/nostr";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { keyTextColor } from "~/lib/color";
import { newSpecPath } from "~/lib/paths";
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
import { MakeKey } from "./make-key";
import { SignInDialog } from "./sign-in-dialog";
import { Unlock } from "./unlock";

/**
 * The header's own control. The server renders it signed out, because the server
 * knows nobody, and it changes one tick after the page becomes interactive. The
 * width that keeps the rest of the line still while it does is reserved around
 * this and the bell together, in `Shell`, rather than around this alone.
 */
export const Identity = () => {
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const close = () => {
    setOpen(false);
    setMaking(false);
  };
  useEffect(restoreSession, []);

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

  return (
    <div className="relative flex shrink-0">
      {session.pubkey === null || npub === null ? (
        <button type="button" className={CHROME} onClick={() => setOpen(!open)}>
          Connect
        </button>
      ) : (
        <button
          type="button"
          title={npub}
          onClick={() => setOpen(!open)}
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
      )}

      {open && (
        <Panel>
          {/* Making a key outlives the moment it succeeds: it signs its reader in
              halfway through, and the step that shows them their key has to
              survive that. So it is not a branch of the signed out panel, it is
              the panel. */}
          {making ? (
            <MakeKey onDone={close} />
          ) : session.pubkey === null || npub === null ? (
            <SignInDialog onDone={close} onMake={() => setMaking(true)} />
          ) : (
            <div className="space-y-3">
              {session.status === "locked" && session.method === "key" ? (
                <Unlock onDone={close} />
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
                {/* The only way in: everything a key says about itself is edited
                    on a page of its own, since a relay list does not fit here. */}
                <Link to={newSpecPath()} className={CHROME} onClick={close}>
                  Write
                </Link>
                <Link to="/settings" className={CHROME} onClick={close}>
                  Your profile
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
                    close();
                    void logout();
                  }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
};
