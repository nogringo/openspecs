import type { Filter } from "nostr-tools/filter";
import { parseCoordinate, toCoordinate } from "./address";
import { type EventDraft, type NostrEvent, newestEvent, nostrEventSchema } from "./event";
import { CLIENT_NAME } from "./nip22";
import { type RelayOptions, relayPool, relaySet } from "./pool";

export const MUTE_LIST_KIND = 10000;

export type MuteType = "p" | "e" | "a";

export type MuteTarget = { type: MuteType; value: string };

/** The public half of a mute list, as far as this site reads one. */
export type MuteList = {
  pubkeys: string[];
  eventIds: string[];
  /** Only coordinates that address a specification. Anything else stays in the event and is ignored here. */
  coordinates: string[];
  /** `content` is not empty: encrypted items exist that this client cannot read. */
  hasPrivate: boolean;
  updatedAt: number;
};

const HEX_64 = /^[0-9a-f]{64}$/;

export const parseMuteList = (input: unknown): MuteList | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== MUTE_LIST_KIND) return null;

  const event = parsed.data;
  const pubkeys = new Set<string>();
  const eventIds = new Set<string>();
  const coordinates = new Set<string>();
  for (const tag of event.tags) {
    const value = (tag[1] ?? "").trim();
    if (tag[0] === "p" && HEX_64.test(value)) pubkeys.add(value);
    else if (tag[0] === "e" && HEX_64.test(value)) eventIds.add(value);
    else if (tag[0] === "a") {
      const pointer = parseCoordinate(value);
      if (pointer !== null) coordinates.add(toCoordinate(pointer));
    }
  }

  return {
    pubkeys: [...pubkeys],
    eventIds: [...eventIds],
    coordinates: [...coordinates],
    hasPrivate: event.content !== "",
    updatedAt: event.created_at,
  };
};

export type MuteChange = { add?: MuteTarget[]; remove?: MuteTarget[] };

const names = (tag: string[], target: MuteTarget): boolean =>
  tag[0] === target.type && tag[1] === target.value;

/**
 * A kind 10000 replaces the whole list, so an edit starts from the live one and
 * hands back everything it held: the `t` and `word` items this site never
 * shows, tags it has never heard of, and `content`, byte for byte, since that is
 * where NIP-51 keeps the private items and only the owner's key can open it.
 */
export const editMuteList = (live: NostrEvent | null, change: MuteChange): EventDraft => {
  const base = live?.kind === MUTE_LIST_KIND ? live : null;
  const removed = change.remove ?? [];
  const tags = (base?.tags ?? []).filter(
    (tag) => tag[0] !== "client" && !removed.some((target) => names(tag, target)),
  );

  // NIP-51 lists `p`, `t`, `word` and `e` for this kind. `a` is this site's
  // addition: it is the only way to name a document, and other clients keep the
  // tags they do not read.
  for (const target of change.add ?? []) {
    if (!tags.some((tag) => names(tag, target))) tags.push([target.type, target.value]);
  }

  return {
    kind: MUTE_LIST_KIND,
    content: base?.content ?? "",
    tags: [...tags, ["client", CLIENT_NAME]],
  };
};

export type MuteListRead = {
  event: NostrEvent | null;
  /** The relays that said they had finished sending. Empty means nobody answered. */
  answered: string[];
};

const MUTE_LIST_TIMEOUT_MS = 5000;

/**
 * The live kind 10000, and which relays finished answering. A replaceable event
 * written back overwrites whatever a relay holds, so whoever writes one has to
 * tell "nothing there" from "nobody answered", and `querySync` folds the two
 * into one empty array. A relay counts as answered on its own EOSE only: one
 * that could not be reached, or had sent nothing by the deadline, is not one
 * whose silence a list can be built on.
 */
export const fetchMuteList = async (
  pubkey: string,
  options: RelayOptions = {},
): Promise<MuteListRead> => {
  const relays = relaySet(options.relays ?? []);
  if (relays.length === 0) return { event: null, answered: [] };

  const pool = options.pool ?? relayPool();
  const timeoutMs = options.timeoutMs ?? MUTE_LIST_TIMEOUT_MS;
  const filter: Filter = { kinds: [MUTE_LIST_KIND], authors: [pubkey] };
  const events: NostrEvent[] = [];
  const answered: string[] = [];

  await new Promise<void>((resolve) => {
    const open = new Map<string, { close: () => void }>();
    let pending = relays.length;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      for (const subscription of open.values()) subscription.close();
      resolve();
    };
    const deadline = setTimeout(finish, timeoutMs);

    const settle = (url: string) => {
      if (!open.delete(url)) return;
      pending -= 1;
      if (pending === 0) finish();
    };

    for (const url of relays) {
      open.set(url, { close: () => {} });
      pool
        .ensureRelay(url, { connectionTimeout: timeoutMs })
        .then((relay) => {
          if (finished) return;
          const subscription = relay.subscribe([filter], {
            onevent: (event) => events.push(event as NostrEvent),
            oneose: () => {
              answered.push(url);
              subscription.close();
            },
            onclose: () => settle(url),
            // The pool fakes an EOSE at this timeout. Kept past the deadline,
            // so the only EOSE that arrives in time is the relay's own.
            eoseTimeout: timeoutMs * 2,
          });
          open.set(url, subscription);
        })
        .catch(() => settle(url));
    }
  });

  return { event: newestEvent(events, pubkey, MUTE_LIST_KIND), answered };
};
