import {
  clearRelayListCache,
  clearServerListCache,
  fetchRelayListEvent,
  fetchServerListEvent,
  parseRelayEntries,
  parseServerList,
  type RelayEntry,
} from "@openspecs/nostr";
import { useOutletContext } from "react-router";
import { Gate, usePublished } from "~/components/settings/published";
import { RelayList } from "~/components/settings/relay-list";
import { ServerList } from "~/components/settings/server-list";
import { PAGE_HEADERS } from "~/lib/http";
import type { Own } from "../settings";
import type { Route } from "./+types/relays";

/** Two lists, and for each of them whether anything came back at all. */
type Published = {
  entries: RelayEntry[];
  relaysMissing: boolean;
  servers: string[];
  serversMissing: boolean;
};

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Where things go | Open Specs" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

const read = async (me: string, relays: string[]): Promise<Published> => {
  const [list, servers] = await Promise.all([
    fetchRelayListEvent(me, { indexers: relays }),
    fetchServerListEvent(me, { indexers: relays }),
  ]);

  return {
    entries: (list === null ? null : parseRelayEntries(list)) ?? [],
    relaysMissing: list === null,
    servers: (servers === null ? null : parseServerList(servers)) ?? [],
    serversMissing: servers === null,
  };
};

/**
 * The two lists that decide where this key's things end up: the relays its
 * documents are written to and looked for on, and the servers its pictures are
 * kept on. Read together because they are asked of the same relays at once.
 */
export default function RelaySettings() {
  const own = useOutletContext<Own>();
  const { state, value, setValue, again } = usePublished(own, read);

  const relaysSaved = (entries: RelayEntry[]) => {
    setValue((was) => (was === null ? was : { ...was, entries, relaysMissing: false }));
    // Or every comment written after this one is sent to the relays that were
    // replaced, which is what the cache still holds.
    clearRelayListCache();
  };

  const serversSaved = (servers: string[]) => {
    setValue((was) => (was === null ? was : { ...was, servers, serversMissing: false }));
    // Or a picture that fails is looked for on the servers that were replaced.
    clearServerListCache();
  };

  return (
    <Gate
      own={own}
      state={state}
      value={value}
      again={again}
      connect="Connect a key to change where its things are kept."
    >
      {({ me, value }) => (
        <div className="space-y-12">
          <RelayList
            me={me}
            published={value.entries}
            missing={value.relaysMissing}
            onSaved={relaysSaved}
          />
          <ServerList
            me={me}
            published={value.servers}
            missing={value.serversMissing}
            onSaved={serversSaved}
          />
        </div>
      )}
    </Gate>
  );
}
