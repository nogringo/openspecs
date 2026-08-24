import { useEffect, useRef, useState } from "react";
import {
  sessionState,
  signInWithBunker,
  signInWithConnect,
  signInWithExtension,
  signInWithSecretKey,
  subscribeSession,
} from "~/lib/session";
import { waitForExtension } from "~/lib/signer-extension";
import { Qr } from "./qr";

type Way = "extension" | "scan" | "paste" | "key";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const Choice = ({ label, note, onPick }: { label: string; note: string; onPick: () => void }) => (
  <button
    type="button"
    onClick={onPick}
    className="w-full rounded-sm border border-rule px-4 py-3 text-left hover:border-muted"
  >
    <span className="block font-mono text-xs">{label}</span>
    <span className="mt-1 block font-serif text-[0.8125rem] leading-snug text-muted">{note}</span>
  </button>
);

/**
 * The ways in, in the order of how much each asks of a reader, and only the ones
 * that can work here: an extension is offered when there is one to offer. What
 * each does with the key is said in the interface rather than left to be
 * guessed, since the last of them is the only one where this page holds a key.
 *
 * Making one comes first, because it is the only one that works for somebody who
 * arrived with nothing, and that is most people. It is handed back to whichever
 * page holds this rather than run here: it signs its reader in halfway through,
 * and this dialog is done the moment anybody is signed in.
 */
export const SignInDialog = ({ onDone, onMake }: { onDone: () => void; onMake: () => void }) => {
  const [way, setWay] = useState<Way | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [bunker, setBunker] = useState("");
  const [nsec, setNsec] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  /**
   * Offered only once an extension has actually answered. Most inject long
   * before this dialog can be opened, so somebody who has one sees it at once
   * and somebody who has none is never sent at a button that cannot work.
   *
   * The look lasts as long as `waitForExtension` polls, which is a few seconds,
   * and it starts again every time the dialog is opened. Installing one and
   * opening this again is what finds it; installing one while this is on screen
   * is not worth an interval that never stops.
   */
  const [hasExtension, setHasExtension] = useState(false);
  useEffect(() => {
    let looking = true;
    void waitForExtension().then((found) => {
      if (looking && found !== null) setHasExtension(true);
    });
    return () => {
      looking = false;
    };
  }, []);

  useEffect(() => {
    const stop = subscribeSession(() => {
      if (sessionState().pubkey !== null) onDone();
    });
    return () => {
      stop();
      abort.current?.abort();
    };
  }, [onDone]);

  const attempt = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "that did not work");
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setWay("scan");
    setUri(null);
    abort.current?.abort();
    abort.current = new AbortController();
    await attempt(async () => {
      const { uri: address, connected } = await signInWithConnect({
        signal: abort.current?.signal,
      });
      setUri(address);
      await connected;
    });
  };

  return (
    <div className="space-y-4">
      {way === null && (
        <div className="space-y-2">
          <Choice
            label="Make a key"
            note="Makes one here and puts your name to it. Start here if you have no key."
            onPick={onMake}
          />
          {hasExtension && (
            <Choice
              label="Browser extension"
              note="Signs with a key your extension already holds. Nothing is typed here."
              onPick={() => void attempt(signInWithExtension)}
            />
          )}
          <Choice
            label="Remote signer"
            note="Scan a code with your signing app, or paste an address it gave you."
            onPick={() => setWay("scan")}
          />
          <Choice
            label="Private key"
            note="Kept on this device, under a PIN if you want one. This page holds your key while the tab is open."
            onPick={() => setWay("key")}
          />
        </div>
      )}

      {way === "scan" && (
        <div className="space-y-4">
          <div className="flex justify-center">
            {uri === null || error !== null ? (
              <button type="button" className={ACTION} onClick={() => void scan()} disabled={busy}>
                {uri === null ? "Show the code" : "Try again"}
              </button>
            ) : (
              <Qr value={uri} />
            )}
          </div>
          {/* One line at a time: a code that is still waiting and a code that
              already failed are two different things to be told. */}
          {uri !== null && error === null && (
            <p className="text-center font-serif text-[0.8125rem] text-muted">
              Waiting for your signer.
            </p>
          )}
          <button
            type="button"
            className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink"
            onClick={() => setWay("paste")}
          >
            Paste an address instead
          </button>
        </div>
      )}

      {way === "paste" && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void attempt(() => signInWithBunker(bunker));
          }}
        >
          <input
            className={FIELD}
            value={bunker}
            onChange={(event) => setBunker(event.target.value)}
            placeholder="bunker://... or you@example.com"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className={ACTION} disabled={busy || bunker.trim() === ""}>
            {busy ? "Connecting" : "Connect"}
          </button>
        </form>
      )}

      {way === "key" && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void attempt(() => signInWithSecretKey(nsec, passphrase));
          }}
        >
          <input
            className={FIELD}
            type="password"
            value={nsec}
            onChange={(event) => setNsec(event.target.value)}
            placeholder="nsec1..."
            autoComplete="off"
            spellCheck={false}
          />
          <input
            className={FIELD}
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="A PIN or passphrase, if you want one"
            autoComplete="new-password"
          />
          {/* Both outcomes said before the choice is made, because the choice is
              about what is left on this device and nobody can see that later. */}
          <p className="font-serif text-[0.8125rem] leading-snug text-muted">
            {passphrase === ""
              ? "Without one your key stays on this device as it is, and you are signed in whenever you come back."
              : "Your key is encrypted with this before it is stored, and it is asked for again each time you open the site."}
          </p>
          <button type="submit" className={ACTION} disabled={busy || nsec.trim() === ""}>
            {busy ? "Connecting" : "Connect"}
          </button>
        </form>
      )}

      {error !== null && (
        <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">{error}</p>
      )}

      {way !== null && (
        <button
          type="button"
          className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink"
          onClick={() => {
            abort.current?.abort();
            setUri(null);
            setError(null);
            setWay(null);
          }}
        >
          Back
        </button>
      )}
    </div>
  );
};
