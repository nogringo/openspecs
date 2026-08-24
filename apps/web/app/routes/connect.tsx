import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { MakeKey } from "~/components/make-key";
import { Shell } from "~/components/shell";
import { SignInDialog } from "~/components/sign-in-dialog";
import { Unlock } from "~/components/unlock";
import { PAGE_HEADERS } from "~/lib/http";
import { returnTo } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/connect";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Connect a key | Open Specs" },
    // The server signs nothing and knows nobody, so what a crawler would index
    // here is a form that can only work in somebody's own browser.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * The ways in, on a page of their own rather than in the panel under the header
 * control. They ask for a pasted key, a passphrase, a name, and they answer with
 * a private key that is shown once: none of that belongs in a box a click in the
 * margin closes, and none of it fits in one on a phone.
 *
 * A page also has an address, which the panel never had. Anything that wants a
 * key can send somebody here and say where they came from, and this sends them
 * back there rather than leaving them to find their way.
 *
 * The one way in that stays in the header is `Unlock`: it is one field, it is
 * usually wanted in the middle of something else, and a page that answers it by
 * navigating away has taken that something else with it. It is offered here too,
 * for whoever arrives at this address with a locked key.
 */
export default function ConnectRoute() {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);
  const [making, setMaking] = useState(false);

  const [params] = useSearchParams();
  const navigate = useNavigate();
  const back = returnTo(params.get("next"));

  const me = session.pubkey;
  const locked = session.status === "locked" && session.method === "key";

  /**
   * Making a key signs its reader in halfway through, and the step that shows
   * them their key has to outlive that: the way back opens when the flow says it
   * is done, not the moment a key exists. `replace`, because this address is
   * somewhere they were sent rather than somewhere they went, and going back
   * should reach the page that sent them.
   */
  useEffect(() => {
    if (me !== null && !making && !locked) void navigate(back, { replace: true });
  }, [me, making, locked, back, navigate]);

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Connect a key</h1>

        {locked && !making ? (
          <div className="mt-8 max-w-sm">
            <Unlock />
          </div>
        ) : (
          <div className="mt-8 max-w-sm space-y-4">
            <p className={NOTE}>
              A key signs what you write and what you mark. Make one here, or connect one you
              already have.
            </p>
            {making ? (
              <MakeKey onDone={() => setMaking(false)} />
            ) : (
              // Nothing for the dialog to close: this page leaves as soon as a
              // key answers, which is the whole of what it would report.
              <SignInDialog onDone={() => {}} onMake={() => setMaking(true)} />
            )}
          </div>
        )}
      </main>
    </Shell>
  );
}
