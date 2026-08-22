import {
  clearProfileCache,
  clearRelayListCache,
  fetchProfileEvent,
  fetchRelayListEvent,
  type NostrEvent,
  parseProfile,
  parseRelayEntries,
  type RelayEntry,
  toNpub,
} from "@openspecs/nostr";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ProfileForm } from "~/components/settings/profile-form";
import { RelayList } from "~/components/settings/relay-list";
import { Shell } from "~/components/shell";
import { Unlock } from "~/components/unlock";
import { PAGE_HEADERS } from "~/lib/http";
import { namedAuthor, toAuthor } from "~/lib/profile";
import { rememberAuthor } from "~/lib/profiles";
import { identityRelays } from "~/lib/relays";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import type { Route } from "./+types/settings";

type Reading = "reading" | "read" | "failed";

const NOTE = "font-serif text-[0.9375rem] leading-relaxed text-muted";

const ACTION =
  "rounded-sm border border-rule px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Your profile | Open Specs" },
    // The server knows nobody, so there is no page here for a crawler to read:
    // what it would index is the sentence asking it to connect a key.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

/**
 * What a key says about itself: the profile every page draws it by, and the
 * relay list that decides where its documents are looked for.
 *
 * Both are read back whole before anything is offered, and for the same reason.
 * Each is a single replaceable event, so a save replaces the lot, and a form
 * that started empty would publish an empty profile over a full one. That read
 * is also why this page has no loader: it is asked for with the reader's key, in
 * the reader's browser, and the server has neither.
 */
export default function SettingsRoute() {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);

  const me = session.pubkey;
  const npub = me === null ? null : toNpub(me);
  const locked = session.status === "locked" && session.method === "key";

  const [reading, setReading] = useState<Reading>("reading");
  const [profile, setProfile] = useState<NostrEvent | null>(null);
  const [entries, setEntries] = useState<RelayEntry[]>([]);
  const [found, setFound] = useState({ profile: false, relays: false });

  // The effect itself, so that trying again is running it again rather than
  // nudging a counter it happens to depend on.
  const read = useCallback(() => {
    if (me === null || locked) return;

    let live = true;
    setReading("reading");

    (async () => {
      try {
        const relays = await identityRelays(me);
        const [kind0, kind10002] = await Promise.all([
          fetchProfileEvent(me, { indexers: relays }),
          fetchRelayListEvent(me, { indexers: relays }),
        ]);
        if (!live) return;

        setProfile(kind0);
        setEntries((kind10002 === null ? null : parseRelayEntries(kind10002)) ?? []);
        setFound({ profile: kind0 !== null, relays: kind10002 !== null });
        setReading("read");
      } catch {
        if (live) setReading("failed");
      }
    })();

    // A key swapped in the header while this page is open must not have the
    // previous one's profile arrive on top of it a second later.
    return () => {
      live = false;
    };
  }, [me, locked]);

  useEffect(read, [read]);

  const onProfileSaved = (event: NostrEvent) => {
    setProfile(event);
    setFound((was) => ({ ...was, profile: true }));
    // The indexers hold what was there for half an hour yet, so the name in the
    // header comes from here instead. `toAuthor` drops a profile with nothing in
    // it, which is what a cleared one is: the key stands in for it, as it does
    // for everybody who published none.
    clearProfileCache();
    if (me !== null) rememberAuthor(me, toAuthor(parseProfile(event)) ?? namedAuthor(""));
  };

  const onRelaysSaved = (saved: RelayEntry[]) => {
    setEntries(saved);
    setFound((was) => ({ ...was, relays: true }));
    // Or every comment written after this one is sent to the relays that were
    // replaced, which is what the cache still holds.
    clearRelayListCache();
  };

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <header>
          <h1 className="font-mono text-2xl font-medium tracking-tight sm:text-3xl">
            Your profile
          </h1>
          {npub !== null && (
            <p className="mt-3 break-all font-mono text-[0.6875rem] text-muted">{npub}</p>
          )}
        </header>

        {me === null || npub === null ? (
          <p className={`mt-8 ${NOTE}`}>Connect a key to change what it says about you.</p>
        ) : locked ? (
          <div className="mt-8 max-w-sm">
            <Unlock />
          </div>
        ) : reading === "reading" ? (
          <p className={`mt-8 ${NOTE}`}>Reading what this key has published.</p>
        ) : reading === "failed" ? (
          <div className="mt-8 space-y-3">
            {/* No form until the live revision is in hand. Saving a profile this
                page never managed to read would replace it with these five
                fields and delete everything else it held. */}
            <p className="font-serif text-[0.9375rem] leading-relaxed text-signal-closed">
              Could not read what this key published, so there is nothing safe to edit yet. Saving
              from here would replace a profile nobody has seen.
            </p>
            <button type="button" className={ACTION} onClick={() => read()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="mt-10 space-y-12">
            <ProfileForm
              me={me}
              npub={npub}
              live={profile}
              missing={!found.profile}
              onSaved={onProfileSaved}
            />

            <section className="border-t border-rule pt-6">
              <RelayList
                me={me}
                published={entries}
                missing={!found.relays}
                onSaved={onRelaysSaved}
              />
            </section>
          </div>
        )}
      </main>
    </Shell>
  );
}
