import { authorPath, buildSpecDeletion, toCoordinate, withdrawSpec } from "@openspecs/nostr";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { RelayReport } from "~/components/relay-results";
import { forgetSpec } from "~/lib/corpus";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { documentRelays } from "~/lib/relays";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import { NOTE, SUGGESTION, WRONG } from "./fields";

type Stage = "closed" | "asking" | "emptying" | "retracting" | "done" | "failed";

const TRIGGER =
  "rounded-sm border border-rule px-2 py-1 text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

/**
 * Hung off the button rather than opened under it, the way a zap and a sign in
 * are on this site. The row this sits in is above the document, and a panel that
 * pushed it down a screenful would move what somebody is reading every time they
 * wondered what this button does.
 */
const PANEL =
  "absolute left-0 top-full z-10 mt-1 w-[min(22rem,calc(100vw-3rem))] space-y-3 rounded-sm border border-rule bg-paper p-3 normal-case tracking-normal shadow-sm";

const LINK = "underline decoration-rule underline-offset-2 hover:decoration-current";

const said = (reason: unknown): string =>
  reason instanceof Error && reason.message.trim() !== "" ? reason.message : "that did not work";

/**
 * Withdrawing a document, which takes two events and cannot take one.
 *
 * A kind 30817 is addressable, so the first is an empty revision that replaces
 * it at the same address: that is the only half a relay ignoring NIP-09 will
 * honour, and what such a relay goes on serving is then a blank record rather
 * than the document. The second is the NIP-09 request to forget the address,
 * which a relay that does honour it answers by dropping every revision there,
 * the empty one included, leaving nothing and a page that 404s.
 *
 * The two are reported separately, because the middle outcome is a real one: a
 * document emptied everywhere and forgotten nowhere is blank rather than gone,
 * and its author should be told that in those words.
 *
 * Offered only to the key that signed the document, so it renders nothing on the
 * server. Nothing has to be read first: an `a` tag names a coordinate, and the
 * empty revision needs only a `d`, both of which are in the address of this page.
 */
export const Withdraw = ({ pubkey, identifier }: { pubkey: string; identifier: string }) => {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);

  const [stage, setStage] = useState<Stage>("closed");
  const [relays, setRelays] = useState<string[]>([]);
  const [emptied, setEmptied] = useState<RelayResult[]>([]);
  const [forgotten, setForgotten] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The empty revision landed somewhere, so the document is blank from then on. */
  const [replaced, setReplaced] = useState(false);
  const [refused, setRefused] = useState(false);

  const me = session.pubkey;
  if (me === null || me !== pubkey) return null;

  const withdraw = async () => {
    setStage("emptying");
    setEmptied([]);
    setForgotten([]);
    setError(null);
    setReplaced(false);
    setRefused(false);

    // Resolved once and handed to both, so the request to forget a document
    // reaches every relay the empty revision was sent to.
    const targets = documentRelays(me);
    targets.then(setRelays).catch(() => {});

    let empty: Awaited<ReturnType<typeof signAndPublish>>;
    try {
      empty = await signAndPublish(withdrawSpec(identifier), targets, (result) =>
        setEmptied((answered) => [...answered, result]),
      );
    } catch (reason) {
      setStage("failed");
      setError(said(reason));
      return;
    }

    // Nothing was replaced anywhere, so there is nothing for a deletion request
    // to finish, and a second signer prompt would be asking for it.
    if (empty.accepted === 0) {
      setStage("failed");
      setError("No relay took the empty revision, so nothing was withdrawn.");
      return;
    }

    setReplaced(true);
    // Dropped from the search here rather than after the request below: what
    // makes this stop being a document is the blank revision, not the asking.
    void forgetSpec(pubkey, identifier);
    setStage("retracting");

    try {
      const forget = await signAndPublish(
        {
          ...buildSpecDeletion(toCoordinate({ pubkey, identifier })),
          /*
           * Strictly after the revision it withdraws, rather than whenever this
           * line runs. NIP-09 has a relay delete every version of an addressable
           * event "up to" this moment and does not say whether that includes it,
           * so a relay reading it as `<` would leave behind the very revision
           * this was sent to remove. Both events are stamped in whole seconds and
           * both can be signed inside one of them, since a local key signs
           * without prompting anybody.
           */
          created_at: Math.max(Math.floor(Date.now() / 1000), empty.event.created_at + 1),
        },
        targets,
        (result) => setForgotten((answered) => [...answered, result]),
      );
      setRefused(forget.accepted === 0);
      setStage("done");
    } catch (reason) {
      setStage("failed");
      setError(
        `The empty revision went out, but the request to forget it did not: ${said(reason)}`,
      );
    }
  };

  const sending = stage === "emptying" || stage === "retracting";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setStage(stage === "closed" ? "asking" : "closed")}
        disabled={sending}
        aria-expanded={stage !== "closed"}
        title="Replace this document with an empty revision, and ask the relays to forget it"
        className={TRIGGER}
      >
        {sending ? "Withdrawing" : "Withdraw"}
      </button>

      {stage !== "closed" && (
        <div className={PANEL}>
          {/* What goes out, before it goes out. Withdrawing is one click of the
              two it takes here, and these sentences are the other one. */}
          {stage === "asking" ? (
            <>
              <p className={NOTE}>
                Two events go out: an empty revision that replaces this one at the same address,
                then a request that the relays forget both. Your signer will ask twice.
              </p>
              <p className={NOTE}>
                A relay is free to keep serving what it already holds, and anyone who kept a copy of
                the event can publish it again.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={SUGGESTION} onClick={withdraw}>
                  Withdraw it
                </button>
                <button type="button" className={SUGGESTION} onClick={() => setStage("closed")}>
                  Keep it
                </button>
              </div>
            </>
          ) : (
            <>
              {error !== null && <p className={WRONG}>{error}</p>}

              {stage === "done" && (
                <p className={refused ? WRONG : NOTE}>
                  {refused
                    ? "Emptied, but no relay accepted the request to forget it, so the document is blank rather than gone."
                    : "Withdrawn. This page goes on showing the copy it was served until the cache in front of it expires."}{" "}
                  <Link to={authorPath(pubkey)} className={LINK}>
                    Everything else you signed
                  </Link>
                  .
                </p>
              )}

              {/* One square per relay for each event, because a withdrawal half
                  taken is a different outcome from one refused outright, and
                  only these say which. */}
              {relays.length > 0 && (
                <div className="space-y-3 uppercase tracking-[0.14em]">
                  <div>
                    <p className="text-muted">Emptied</p>
                    <RelayReport relays={relays} results={emptied} done={stage !== "emptying"} />
                  </div>
                  {replaced && (
                    <div>
                      <p className="text-muted">Forgotten</p>
                      <RelayReport
                        relays={relays}
                        results={forgotten}
                        done={stage === "done" || stage === "failed"}
                      />
                    </div>
                  )}
                </div>
              )}

              {!sending && (
                <button
                  type="button"
                  className={SUGGESTION}
                  onClick={() => setStage(stage === "failed" ? "asking" : "closed")}
                >
                  {stage === "failed" ? "Try again" : "Close"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
