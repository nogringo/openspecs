import { buildProfile, buildRelayList } from "@openspecs/nostr";
import { useState } from "react";
import { CopyButton } from "~/components/copy-button";
import { RelayReport } from "~/components/relay-results";
import { namedAuthor } from "~/lib/profile";
import { rememberAuthor } from "~/lib/profiles";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { announceRelays, newKeyRelays } from "~/lib/relays";
import { protectKey, sessionNsec, signInWithNewKey } from "~/lib/session";

type Step = "name" | "backup";
type Telling = "sending" | "told" | "unheard";
type Locking = "open" | "locking" | "locked";

const FIELD =
  "w-full rounded-sm border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const LABEL = "font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted";

/**
 * A key for somebody who has none, which is every reader this site has not met.
 *
 * The order is the whole of the design. The key is generated and stored before a
 * single byte leaves the tab, so a tab closed halfway through loses the copy on
 * screen and never the key itself; the two events that announce it go out
 * afterwards and are not waited for, because nothing they can answer changes
 * whether the key works. What cannot be recovered is on screen first.
 */
export const MakeKey = ({ onDone }: { onDone: () => void }) => {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nsec, setNsec] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [pin, setPin] = useState("");
  const [locking, setLocking] = useState<Locking>("open");
  const [pinError, setPinError] = useState<string | null>(null);

  const [telling, setTelling] = useState<Telling>("sending");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);

  const announce = async (chosen: string) => {
    setTelling("sending");
    setResults([]);
    const targets = announceRelays();
    setRelays(targets);

    // Both at once and to the same relays. The profile is the one reported: it is
    // what a person is seen by, and a relay taking one replaceable event takes
    // the other. A refusal of either leaves a key that still signs.
    const [profile] = await Promise.allSettled([
      signAndPublish(buildProfile({ name: chosen }), targets, (result) =>
        setResults((answered) => [...answered, result]),
      ),
      signAndPublish(buildRelayList(newKeyRelays()), targets),
    ]);

    setTelling(profile.status === "fulfilled" && profile.value.accepted > 0 ? "told" : "unheard");
  };

  const make = (event: React.FormEvent) => {
    event.preventDefault();
    const chosen = name.trim();
    if (chosen === "") return;

    setBusy(true);
    setError(null);
    try {
      const pubkey = signInWithNewKey();
      // Their own name, before any indexer has heard of it: asking for it now
      // would cache half an hour of nothing over the name they just typed.
      rememberAuthor(pubkey, namedAuthor(chosen));
      setNsec(sessionNsec());
      setStep("backup");
      void announce(chosen);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "that did not work");
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setLocking("locking");
    setPinError(null);
    try {
      await protectKey(pin);
      setLocking("locked");
    } catch (reason) {
      setLocking("open");
      setPinError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  if (step === "name") {
    return (
      <form className="space-y-3" onSubmit={make}>
        <p className={NOTE}>
          A key is made in this browser and stays here. The name goes with it, so people see
          something other than a string of characters.
        </p>
        <input
          className={FIELD}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="The name you want to be called"
          autoComplete="nickname"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={ACTION} disabled={busy || name.trim() === ""}>
            {busy ? "Making" : "Make my key"}
          </button>
          <button
            type="button"
            className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:text-ink"
            onClick={onDone}
          >
            Back
          </button>
        </div>
        {error !== null && (
          <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">{error}</p>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className={LABEL}>Your private key</p>
        {/* Covered until it is asked for. Copying it needs nobody to read it, and
            what is on a screen is readable by whoever else is in the room. It is
            shown at all because writing it down is the one thing that saves it. */}
        {shown ? (
          <p className="break-all font-mono text-[0.6875rem]">{nsec}</p>
        ) : (
          <p aria-hidden="true" className="break-all select-none font-mono text-[0.6875rem]">
            {"•".repeat(nsec?.length ?? 0)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
          <CopyButton value={nsec ?? ""} label="Copy" title="Your private key, the nsec" />
          <button
            type="button"
            className="text-muted hover:text-ink"
            onClick={() => setShown(!shown)}
          >
            {shown ? "Hide" : "Show"}
          </button>
        </div>
        <p className={NOTE}>
          This is the only copy of it. Nobody can send it to you again, and anyone who has it can
          sign as you. It stays here, behind your name in the header, until you disconnect and this
          device forgets it.
        </p>
      </div>

      <div className="space-y-2">
        <p className={LABEL}>A PIN, if you want one</p>
        {locking === "locked" ? (
          <p className={NOTE}>
            Done. You stay signed in here, and it is asked for the next time you open the site.
          </p>
        ) : (
          <>
            <input
              className={FIELD}
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="A PIN or passphrase, if you want one"
              autoComplete="new-password"
            />
            {/* The same two sentences the pasted key gets, because both ways of
                ending up with a key on this device end up in the same place. */}
            <p className={NOTE}>
              {pin === ""
                ? "Without one your key stays on this device as it is, and you are signed in whenever you come back."
                : "Your key is encrypted with this before it is stored, and it is asked for again each time you open the site."}
            </p>
            <button
              type="button"
              className={ACTION}
              onClick={() => void lock()}
              disabled={locking === "locking" || pin === ""}
            >
              {locking === "locking" ? "Locking" : "Lock it"}
            </button>
            {pinError !== null && (
              <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">
                {pinError}
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <p className={LABEL}>Telling the relays</p>
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
          <RelayReport relays={relays} results={results} done={telling !== "sending"} />
        </div>
        {telling === "sending" && (
          <p className={NOTE}>
            Sending your name and where you publish, so other clients can find you.
          </p>
        )}
        {telling === "unheard" && (
          <>
            <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">
              No relay took it, so the name is not published yet. Your key works all the same, and
              you can try again.
            </p>
            <button type="button" className={ACTION} onClick={() => void announce(name.trim())}>
              Try again
            </button>
          </>
        )}
      </div>

      <button type="button" className={ACTION} onClick={onDone}>
        Done
      </button>
    </div>
  );
};
