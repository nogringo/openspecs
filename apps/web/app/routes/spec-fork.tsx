import { fetchSpecEvent, type NostrEvent, parsePubkey, toNpub } from "@openspecs/nostr";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { SpecEditor } from "~/components/editor/spec-editor";
import { MakeKey } from "~/components/make-key";
import { Shell } from "~/components/shell";
import { SignInDialog } from "~/components/sign-in-dialog";
import { Unlock } from "~/components/unlock";
import { PAGE_HEADERS } from "~/lib/http";
import { specEditPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/spec-fork";

type Reading = "reading" | "read" | "missing" | "failed";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

const WRONG = "font-serif text-[0.9375rem] leading-relaxed text-signal-closed";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

const LINK = "underline decoration-rule underline-offset-2 hover:decoration-current";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Fork a document | Open Specs" },
    // The document being forked has its own page, and this one holds a form
    // nobody but its reader can use.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * Writing somebody else's document again, under the reader's own key.
 *
 * The document is read before the form is offered, the way editing one is, but
 * for the opposite reason: nothing here is at risk of being written over, and
 * what a fork starts from is the whole of the origin, tags included, so a form
 * filled from a revision this page never managed to read would be a fork of
 * nothing.
 *
 * The reading starts as soon as the address resolves, without waiting for a key.
 * The origin is public, and somebody who arrives with no key and connects one
 * here already has the document in hand when the form appears. Making a key is
 * offered on the page rather than in the header for the same reason: whoever
 * clicked Fork on a document is often somebody who has never signed anything.
 */
export default function SpecForkRoute({ params }: Route.ComponentProps) {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);
  const [making, setMaking] = useState(false);

  const me = session.pubkey;
  const locked = session.status === "locked" && session.method === "key";
  const pubkey = parsePubkey(params.author);
  const identifier = params.identifier;

  const [reading, setReading] = useState<Reading>("reading");
  const [event, setEvent] = useState<NostrEvent | null>(null);

  // The effect itself, so that trying again is running it again rather than
  // nudging a counter it happens to depend on.
  const read = useCallback(() => {
    if (pubkey === null) return;

    let live = true;
    setReading("reading");

    (async () => {
      try {
        const found = await fetchSpecEvent({ pubkey, identifier });
        if (!live) return;
        setEvent(found);
        setReading(found === null ? "missing" : "read");
      } catch {
        if (live) setReading("failed");
      }
    })();

    return () => {
      live = false;
    };
  }, [pubkey, identifier]);

  useEffect(read, [read]);

  return (
    <Shell>
      {/* The editor draws its own title at the size the published page uses, so
          the page's own heading steps back to a line naming where you are. */}
      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <h1 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
          Forking
        </h1>

        {pubkey === null ? (
          <p className={`mt-8 ${WRONG}`}>That is not the address of a document.</p>
        ) : reading === "reading" ? (
          <p className={`mt-8 ${NOTE}`}>Reading the document to start from.</p>
        ) : reading !== "read" || event === null ? (
          <div className="mt-8 space-y-3">
            <p className={WRONG}>
              {reading === "missing"
                ? "Nothing came back at this address. Either no document was published here, or no relay answered just now."
                : "Could not reach the relays, so there is nothing to start from yet."}
            </p>
            <button type="button" className={ACTION} onClick={() => read()}>
              Try again
            </button>
          </div>
        ) : me === null || making ? (
          // Making a key signs its reader in halfway through, so the step showing
          // them their key has to outlive that: the way in holds the page until
          // it says it is done, rather than until a key exists.
          <div className="mt-8 max-w-sm space-y-4">
            <p className={NOTE}>Connect a key to publish this document under it.</p>
            {making ? (
              <MakeKey onDone={() => setMaking(false)} />
            ) : (
              <SignInDialog onDone={() => {}} onMake={() => setMaking(true)} />
            )}
          </div>
        ) : locked ? (
          <div className="mt-8 max-w-sm">
            <Unlock />
          </div>
        ) : (
          <div className="mt-10 space-y-6">
            {/* Said before the form rather than after the refusal: a copy of your
                own document under its own name is the document, and the only
                other feedback would be the taken address the editor reports. */}
            {me === pubkey && (
              <p className={NOTE}>
                This document is already yours. A copy of it under the same name is the same
                document, so leave the address alone only if you meant to{" "}
                <Link to={specEditPath(toNpub(pubkey), identifier)} className={LINK}>
                  revise it
                </Link>{" "}
                instead.
              </p>
            )}
            <SpecEditor
              me={me}
              npub={toNpub(me)}
              live={null}
              fork={{ origin: event, relay: null }}
            />
          </div>
        )}
      </main>
    </Shell>
  );
}
