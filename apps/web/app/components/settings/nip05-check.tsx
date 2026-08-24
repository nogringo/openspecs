import { checkNip05, type Nip05Check, parseNip05Address } from "@openspecs/nostr";
import { useEffect, useState } from "react";

/** Long enough that a half-typed domain is not asked about on the way past. */
const SETTLE_MS = 600;

const NOTE = "font-serif text-[0.8125rem] leading-snug text-muted";

const WRONG = "font-serif text-[0.8125rem] leading-snug text-signal-closed";

const RIGHT = "font-serif text-[0.8125rem] leading-snug text-signal-settled";

type Asking = "asking";

/**
 * Whether the domain in the reader's own address answers with their key.
 *
 * Asked from the browser rather than through this server, which is the way
 * NIP-05 means it to be asked: it tells domains to serve this with
 * `Access-Control-Allow-Origin: *` so that any page can. A domain that does not
 * is a thing worth telling its owner, and its owner is who is reading this.
 *
 * The same NIP is clear that a refusal is indistinguishable from an empty
 * answer, so the line below says both rather than picking one.
 */
export const AddressCheck = ({ me, address }: { me: string; address: string }) => {
  const [answer, setAnswer] = useState<Nip05Check | Asking | null>(null);
  const value = address.trim();

  useEffect(() => {
    if (value === "") {
      setAnswer(null);
      return;
    }

    setAnswer("asking");
    let live = true;
    const timer = setTimeout(() => {
      checkNip05(me, value)
        .then((check) => live && setAnswer(check))
        .catch(() => live && setAnswer("unreachable"));
    }, SETTLE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [me, value]);

  if (answer === null) return null;

  const domain = parseNip05Address(value)?.domain ?? "that domain";

  if (answer === "asking") return <p className={NOTE}>Asking {domain}.</p>;

  if (answer === "malformed")
    return <p className={WRONG}>An address is a name at a domain, like you@example.com.</p>;

  if (answer === "confirmed") return <p className={RIGHT}>{domain} answers with your key.</p>;

  if (answer === "contradicted")
    return (
      <p className={WRONG}>
        {domain} answers with another key, so this address is somebody else's and your page will not
        show it as yours.
      </p>
    );

  return (
    <p className={NOTE}>
      {domain} did not answer. Either it publishes nothing under this name, or it does not let a
      browser ask, which is a header whoever runs it can add.
    </p>
  );
};
