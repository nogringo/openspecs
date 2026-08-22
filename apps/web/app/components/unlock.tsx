import { useState } from "react";
import { unlock } from "~/lib/session";

const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

/**
 * A key stored under a passphrase, asked for wherever it is wanted rather than
 * only in the header: a page that needs a signature has to be able to open the
 * one on this device without sending its reader somewhere else to do it.
 */
export const Unlock = ({ onDone }: { onDone?: () => void }) => {
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
          .then(() => onDone?.())
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
