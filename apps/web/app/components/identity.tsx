import { toNpub } from "@openspecs/nostr";
import { useEffect, useState, useSyncExternalStore } from "react";
import { authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors, wantAuthors } from "~/lib/profiles";
import {
  logout,
  restoreSession,
  serverSessionState,
  sessionState,
  subscribeSession,
  unlock,
} from "~/lib/session";
import { AuthorAvatar } from "./author-avatar";
import { SignInDialog } from "./sign-in-dialog";

const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

/**
 * The header is set in wide-tracked capitals, and everything inside it inherits
 * that. A panel is not chrome, it is a place to read a sentence and a key, so it
 * puts the type back to normal and lets what wants the chrome ask for it.
 */
const Panel = ({ children }: { children: React.ReactNode }) => (
  <div className="absolute right-0 top-full z-10 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-sm border border-rule bg-paper p-4 text-sm normal-case tracking-normal shadow-sm">
    {children}
  </div>
);

const Unlock = ({ onDone }: { onDone: () => void }) => {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        unlock(passphrase)
          .then(onDone)
          .catch(() => setError("That does not open this key."))
          .finally(() => setBusy(false));
      }}
    >
      <p className="font-serif text-[0.8125rem] leading-snug text-muted">
        Your key is on this device, under a PIN or passphrase.
      </p>
      <input
        className="w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink"
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        autoComplete="current-password"
      />
      <button type="submit" className={CHROME} disabled={busy || passphrase === ""}>
        {busy ? "Unlocking" : "Unlock"}
      </button>
      {error !== null && <p className="font-serif text-[0.8125rem] text-signal-closed">{error}</p>}
    </form>
  );
};

/**
 * The header's own control. The server renders it signed out, because the server
 * knows nobody, and it changes one tick after the page becomes interactive: the
 * slot it sits in is a fixed width so that nothing beside it moves when it does.
 */
export const Identity = () => {
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative flex shrink-0 justify-end sm:min-w-24">
      {session.pubkey === null || npub === null ? (
        <>
          <button type="button" className={CHROME} onClick={() => setOpen(!open)}>
            Connect
          </button>
          {open && (
            <Panel>
              <SignInDialog onDone={() => setOpen(false)} />
            </Panel>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            title={npub}
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-sm border border-rule px-1.5 py-1 hover:border-muted"
          >
            <AuthorAvatar pubkey={session.pubkey} picture={me?.picture ?? null} size={18} />
            {/* A narrow screen has room for a face and not for a name. */}
            <span className="hidden max-w-32 truncate font-mono text-[0.6875rem] normal-case tracking-normal text-muted sm:block">
              {authorName(me, npub)}
            </span>
          </button>
          {open && (
            <Panel>
              <div className="space-y-3">
                {session.status === "locked" && session.method === "key" ? (
                  <Unlock onDone={() => setOpen(false)} />
                ) : (
                  <div className="flex items-start gap-3">
                    <AuthorAvatar pubkey={session.pubkey} picture={me?.picture ?? null} size={32} />
                    <div className="min-w-0">
                      {me?.name && <p className="truncate font-mono text-xs">{me.name}</p>}
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

                <button
                  type="button"
                  className={CHROME}
                  onClick={() => {
                    setOpen(false);
                    void logout();
                  }}
                >
                  Disconnect
                </button>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
};
