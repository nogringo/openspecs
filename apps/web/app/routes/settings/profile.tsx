import {
  clearProfileCache,
  fetchProfileEvent,
  type NostrEvent,
  parseProfile,
} from "@openspecs/nostr";
import { useOutletContext } from "react-router";
import { ProfileForm } from "~/components/settings/profile-form";
import { Gate, usePublished } from "~/components/settings/published";
import { PAGE_HEADERS } from "~/lib/http";
import { namedAuthor, toAuthor } from "~/lib/profile";
import { rememberAuthor } from "~/lib/profiles";
import type { Own } from "../settings";
import type { Route } from "./+types/profile";

/** Nothing came back is not the same as this key having nothing, so both are kept. */
type Published = { event: NostrEvent | null };

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

const read = async (me: string, relays: string[]): Promise<Published> => ({
  event: await fetchProfileEvent(me, { indexers: relays }),
});

/** What every page draws this key by: its name, its face, and the two addresses. */
export default function ProfileSettings() {
  const own = useOutletContext<Own>();
  const { state, value, setValue, again } = usePublished(own, read);

  const saved = (me: string) => (event: NostrEvent) => {
    setValue({ event });
    // The indexers hold what was there for half an hour yet, so the name in the
    // header comes from here instead. `toAuthor` drops a profile with nothing in
    // it, which is what a cleared one is: the key stands in for it, as it does
    // for everybody who published none.
    clearProfileCache();
    rememberAuthor(me, toAuthor(parseProfile(event)) ?? namedAuthor(""));
  };

  return (
    <Gate
      own={own}
      state={state}
      value={value}
      again={again}
      connect="Connect a key to change what it says about you."
    >
      {({ me, npub, value }) => (
        <ProfileForm
          me={me}
          npub={npub}
          live={value.event}
          missing={value.event === null}
          onSaved={saved(me)}
        />
      )}
    </Gate>
  );
}
