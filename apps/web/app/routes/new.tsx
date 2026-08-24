import { toNpub } from "@openspecs/nostr";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SpecEditor } from "~/components/editor/spec-editor";
import { MakeKey } from "~/components/make-key";
import { Shell } from "~/components/shell";
import { SignInDialog } from "~/components/sign-in-dialog";
import { Unlock } from "~/components/unlock";
import { PAGE_HEADERS } from "~/lib/http";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/new";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Write a document | Open Specs" },
    // The server signs nothing and knows nobody, so what a crawler would index
    // here is the sentence asking it to connect a key.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * A document nobody has published yet. There is nothing to read first, so unlike
 * the page that edits one this offers its form straight away.
 *
 * No loader, and none is possible: the document is signed with the reader's key,
 * in the reader's browser, and this server has neither.
 *
 * Somebody arriving here with no key is offered the ways in on the page rather
 * than sent to find them in the header, because this is the address that says
 * what they came to do.
 */
export default function NewSpecRoute() {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);
  const [making, setMaking] = useState(false);

  const me = session.pubkey;
  const locked = session.status === "locked" && session.method === "key";

  return (
    <Shell>
      {/* The editor draws its own title at the size the published page uses, so
          the page's own heading steps back to a line naming where you are. */}
      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <h1 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
          New document
        </h1>

        {/* Making a key signs its reader in halfway through, so the step showing
            them their key has to outlive that: the way in holds the page until it
            says it is done, rather than until a key exists. */}
        {me === null || making ? (
          <div className="mt-8 max-w-sm space-y-4">
            <p className={NOTE}>Connect a key to write a document with it.</p>
            {making ? (
              <MakeKey onDone={() => setMaking(false)} />
            ) : (
              // Nothing for the dialog to close: the editor takes the page as
              // soon as a key answers, which is the whole of what it reports.
              <SignInDialog onDone={() => {}} onMake={() => setMaking(true)} />
            )}
          </div>
        ) : locked ? (
          <div className="mt-8 max-w-sm">
            <Unlock />
          </div>
        ) : (
          <div className="mt-8">
            <SpecEditor me={me} npub={toNpub(me)} live={null} />
          </div>
        )}
      </main>
    </Shell>
  );
}
