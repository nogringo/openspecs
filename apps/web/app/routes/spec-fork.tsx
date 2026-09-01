import { fetchSpecEvent, type NostrEvent, parsePubkey, parseSpec, toNpub } from "@openspecs/nostr";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SpecEditor } from "~/components/editor/spec-editor";
import { MakeKey } from "~/components/make-key";
import { Shell } from "~/components/shell";
import { SignInDialog } from "~/components/sign-in-dialog";
import { Unlock } from "~/components/unlock";
import { PAGE_HEADERS } from "~/lib/http";
import { eventPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/spec-fork";

type Reading = "reading" | "read" | "missing" | "failed";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

const WRONG = "font-serif text-[0.9375rem] leading-relaxed text-signal-closed";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

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
/**
 * The document as this server last read it, which is the copy the page offering
 * Fork was rendered from and is already in its cache. Asked first because the
 * relays are six sockets and a four second window from a cold browser, and this
 * is one request to the origin the reader is already on.
 *
 * Safe here and nowhere near the editor of one's own document: a fork replaces
 * nothing, so a revision a minute old costs a sentence somebody retypes, where
 * an edit built on one would publish over whatever came since. Null rather than
 * an error when there is nothing here to serve, and the relays are then asked
 * properly: this backend is an accelerator, and a build without one still works.
 */
const fromServer = async (pubkey: string, identifier: string): Promise<NostrEvent | null> => {
  try {
    const response = await fetch(eventPath(toNpub(pubkey), identifier));
    if (!response.ok) return null;
    const spec = parseSpec(await response.json());
    return spec !== null && spec.pubkey === pubkey && spec.identifier === identifier
      ? spec.event
      : null;
  } catch {
    return null;
  }
};

/** `"unreachable"` is not `null`: nothing came back is not the same as nothing is there. */
const fromRelays = async (
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | null | "unreachable"> => {
  try {
    return await fetchSpecEvent({ pubkey, identifier });
  } catch {
    return "unreachable";
  }
};

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
      const found =
        (await fromServer(pubkey, identifier)) ?? (await fromRelays(pubkey, identifier));
      if (!live) return;
      if (found === "unreachable") {
        setReading("failed");
        return;
      }
      setEvent(found);
      setReading(found === null ? "missing" : "read");
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
          /* Nothing said here about forking your own document. The editor asks the
             relays what this key already publishes at that address the moment it
             opens, and answers that and a collision with somebody else's name in
             the same words, beside the address they are about. */
          <div className="mt-10">
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
