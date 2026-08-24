import { toNpub } from "@openspecs/nostr";
import { useEffect, useSyncExternalStore } from "react";
import { NavLink, Outlet } from "react-router";
import { TAB_OFF, TAB_ON } from "~/components/chrome";
import { Shell } from "~/components/shell";
import { browserSettingsPath, relaySettingsPath, settingsPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";

/** Whose settings these are, read once here and handed to whichever tab is open. */
export type Own = {
  me: string | null;
  npub: string | null;
  /** A key on this device, and shut. There is nothing to read until it opens. */
  locked: boolean;
};

const Tab = ({ to, end, children }: { to: string; end?: boolean; children: string }) => (
  <NavLink to={to} end={end} className={({ isActive }) => (isActive ? TAB_ON : TAB_OFF)}>
    {children}
  </NavLink>
);

/**
 * Three unrelated things used to sit on this page one under the other, under a
 * heading that named only the first of them. So the page is named for what it is
 * and says on its face what it holds: what a key publishes about itself, where
 * it keeps things, and what this browser does on its own.
 *
 * Each has an address, because the way here used to be a single word in a menu
 * and nobody could be sent to anything but the top of it.
 */
export default function SettingsRoute() {
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  useEffect(restoreSession, []);

  const me = session.pubkey;
  const own: Own = {
    me,
    npub: me === null ? null : toNpub(me),
    locked: session.status === "locked" && session.method === "key",
  };

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <header>
          <h1 className="font-mono text-2xl font-medium tracking-tight sm:text-3xl">Settings</h1>
          {own.npub !== null && (
            <p className="mt-3 break-all font-mono text-[0.6875rem] text-muted">{own.npub}</p>
          )}
        </header>

        {/* All three whether or not a key is connected: the last one is this
            browser's own and has nothing to do with a key. */}
        <nav aria-label="Settings" className="mt-8 flex flex-wrap items-center gap-1">
          <Tab to={settingsPath()} end>
            Profile
          </Tab>
          <Tab to={relaySettingsPath()}>Where things go</Tab>
          <Tab to={browserSettingsPath()}>This browser</Tab>
        </nav>

        <div className="mt-10">
          <Outlet context={own} />
        </div>
      </main>
    </Shell>
  );
}
