import { fetchSpecEvent, type NostrEvent, parsePubkey, specPath, toNpub } from "@openspecs/nostr";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { SpecEditor } from "~/components/editor/spec-editor";
import { Shell } from "~/components/shell";
import { Unlock } from "~/components/unlock";
import { PAGE_HEADERS } from "~/lib/http";
import { newSpecPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/spec-edit";

type Reading = "reading" | "read" | "missing" | "failed";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

const WRONG = "font-serif text-[0.9375rem] leading-relaxed text-signal-closed";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

const LINK = "underline decoration-rule underline-offset-2 hover:decoration-current";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Edit a document | Open Specs" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * Editing a document, which means reading it whole before offering a form.
 * A kind 30817 replaces the whole of its previous revision, so a form that
 * started empty would publish an empty document over a written one, and one
 * filled from a revision this page never managed to read would drop every tag it
 * could not see.
 *
 * The address only ever names the reader's own key: a revision published from
 * here is signed by whoever is connected, so publishing under somebody else's
 * npub does not change their document, it starts a different one.
 */
export default function SpecEditRoute({ params }: Route.ComponentProps) {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);

  const me = session.pubkey;
  const locked = session.status === "locked" && session.method === "key";
  const pubkey = parsePubkey(params.author);
  const identifier = params.identifier;
  const mine = pubkey !== null && me === pubkey;

  const [reading, setReading] = useState<Reading>("reading");
  const [event, setEvent] = useState<NostrEvent | null>(null);

  // The effect itself, so that trying again is running it again rather than
  // nudging a counter it happens to depend on.
  const read = useCallback(() => {
    if (!mine || locked || pubkey === null) return;

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

    // A key swapped in the header while this page is open must not have the
    // previous one's document arrive on top of it a second later.
    return () => {
      live = false;
    };
  }, [mine, locked, pubkey, identifier]);

  useEffect(read, [read]);

  return (
    <Shell>
      {/* The editor draws its own title at the size the published page uses, so
          the page's own heading steps back to a line naming where you are. */}
      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <h1 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
          Editing
        </h1>

        {pubkey === null ? (
          <p className={`mt-8 ${WRONG}`}>That is not the address of a document.</p>
        ) : me === null ? (
          <p className={`mt-8 ${NOTE}`}>Connect the key that signed this document to edit it.</p>
        ) : locked ? (
          <div className="mt-8 max-w-sm">
            <Unlock />
          </div>
        ) : !mine ? (
          <div className="mt-8 space-y-3">
            <p className={WRONG}>
              Another key signed this document. A revision published from here would be signed by
              yours, which makes a different document at a different address rather than a change to
              this one.
            </p>
            <p className={NOTE}>
              <Link to={specPath({ pubkey, identifier })} className={LINK}>
                Read it instead
              </Link>
              , or{" "}
              <Link to={newSpecPath()} className={LINK}>
                write one of your own
              </Link>
              .
            </p>
          </div>
        ) : reading === "reading" ? (
          <p className={`mt-8 ${NOTE}`}>Reading what this key published here.</p>
        ) : reading === "read" ? (
          <div className="mt-10">
            <SpecEditor me={me} npub={toNpub(me)} live={event} />
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {/* No form until the live revision is in hand. Saving a document this
                page never managed to read would replace it with these fields and
                delete every tag it could not see. */}
            <p className={WRONG}>
              {reading === "missing"
                ? "Nothing came back at this address. Either this key published no document here, or no relay answered just now."
                : "Could not reach the relays, so there is nothing safe to edit yet."}{" "}
              Publishing from here would replace a document nobody has read.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={ACTION} onClick={() => read()}>
                Try again
              </button>
              <p className={NOTE}>
                Or{" "}
                <Link to={newSpecPath()} className={LINK}>
                  start a new document
                </Link>
                .
              </p>
            </div>
          </div>
        )}
      </main>
    </Shell>
  );
}
