import type { NostrEvent } from "@openspecs/nostr";
import {
  applyLive,
  blockedState,
  markUnpublished,
  type Owed,
  pauseOwed,
  settleOwed,
  subscribeBlocked,
} from "./blocked";
import { sessionState, subscribeSession } from "./session";
import { SessionLocked, SessionMissing } from "./signer";

/**
 * How long the relays are given to say what list they hold. The same figure as
 * a like's patience, and the opposite consequence: a like left unsent is a
 * click lost, so it goes out anyway, while a list built on nothing overwrites a
 * list kept elsewhere, so it does not.
 */
const READ_TIMEOUT_MS = 5000;

const RETRY_MS = 60_000;

let started = false;
let inFlight: Promise<void> | null = null;
let again = false;
let retry: ReturnType<typeof setTimeout> | null = null;
/** What this tab signed last: a relay may still be serving the revision before it. */
let lastSigned: NostrEvent | null = null;
let owedSeen = 0;

const NOTHING = { pubkeys: [], eventIds: [], coordinates: [], hasPrivate: false };

const newer = (a: NostrEvent | null, b: NostrEvent | null): NostrEvent | null =>
  a === null ? b : b === null ? a : b.created_at > a.created_at ? b : a;

const withoutClient = (tags: string[][]): string =>
  JSON.stringify(tags.filter((tag) => tag[0] !== "client"));

const armRetry = (): void => {
  retry ??= setTimeout(() => {
    retry = null;
    void syncMuteList();
  }, RETRY_MS);
};

/**
 * One round: read the live list, take it in, and sign what this device owes on
 * top of it.
 *
 * Nothing is signed unless at least one of the reader's own write relays said
 * it had finished answering. A default relay answering "nothing" while the
 * reader's own relay is down is exactly the case that would publish an empty
 * list over the one their other clients keep. Until then the debt stays where
 * it is, on disk, and the next round tries again.
 */
const round = async (me: string): Promise<void> => {
  const [nostr, relays, publish, outbox] = await Promise.all([
    import("@openspecs/nostr"),
    import("./relays"),
    import("./publish"),
    import("./outbox"),
  ]);
  if (sessionState().pubkey !== me) return;

  const [targets, mine] = await Promise.all([
    relays.muteListRelays(me).catch(() => nostr.relaySet(nostr.DEFAULT_RELAYS)),
    relays.outboxRelays(me).then(nostr.relaySet, () => nostr.relaySet(nostr.DEFAULT_RELAYS)),
  ]);
  const read = await nostr.fetchMuteList(me, { relays: targets, timeoutMs: READ_TIMEOUT_MS });
  if (sessionState().pubkey !== me) return;

  if (!read.answered.some((relay) => mine.includes(relay))) {
    armRetry();
    return;
  }

  const live = newer(read.event, lastSigned);
  applyLive(nostr.parseMuteList(live) ?? NOTHING);

  const { owed, refused } = blockedState();
  if (refused || owed.length === 0) return;

  const strip = ({ type, value }: Owed) => ({ type, value });
  const draft = nostr.editMuteList(live, {
    add: owed.filter((entry) => entry.op === "add").map(strip),
    remove: owed.filter((entry) => entry.op === "remove").map(strip),
  });
  // Another client already did it, or a removal of something the list never
  // held: nothing to sign, and the debt is paid.
  if (withoutClient(draft.tags) === withoutClient(live?.tags ?? [])) {
    settleOwed(owed);
    return;
  }

  let event: NostrEvent;
  try {
    event = await publish.signDraft({
      ...draft,
      // Strictly after what it replaces, however fast the two were signed.
      created_at: Math.max(Math.floor(Date.now() / 1000), (live?.created_at ?? 0) + 1),
    });
  } catch (reason) {
    // A key still under its passphrase signs later. A reader who said no in
    // their extension is not asked again on every page: the debt waits until
    // they block something else, or ask for it on the settings page.
    if (reason instanceof SessionLocked || reason instanceof SessionMissing) return;
    pauseOwed();
    return;
  }
  if (sessionState().pubkey !== me) return;

  lastSigned = event;
  settleOwed(owed);
  outbox.enqueue(event, targets);
};

/** One round at a time. A change made mid-round follows it rather than waiting for the retry. */
export const syncMuteList = (): Promise<void> => {
  const me = sessionState().pubkey;
  if (me === null || typeof window === "undefined") return Promise.resolve();
  if (inFlight !== null) {
    again = true;
    return inFlight;
  }
  if (retry !== null) {
    clearTimeout(retry);
    retry = null;
  }

  inFlight = round(me)
    .catch(armRetry)
    .then(() => {
      inFlight = null;
      if (again) {
        again = false;
        void syncMuteList();
      }
    });
  return inFlight;
};

/**
 * Called once per page load, from the frame every page shares. A round runs
 * when a key connects, when a locked key opens with something owed, when a
 * block or an unblock adds to the debt, and when the browser comes back online.
 */
export const startMuteSync = (): void => {
  if (started || typeof window === "undefined") return;
  started = true;

  let key = sessionState().pubkey;
  let status = sessionState().status;
  subscribeSession(() => {
    const session = sessionState();
    if (session.pubkey !== key) {
      key = session.pubkey;
      lastSigned = null;
      markUnpublished();
      if (key !== null) void syncMuteList();
    } else if (session.status === "ready" && status !== "ready" && blockedState().owed.length > 0) {
      void syncMuteList();
    }
    status = session.status;
  });

  owedSeen = blockedState().owed.length;
  subscribeBlocked(() => {
    const owed = blockedState().owed.length;
    if (owed > owedSeen) void syncMuteList();
    owedSeen = owed;
  });

  window.addEventListener("online", () => void syncMuteList());
  void syncMuteList();
};

export const clearMuteSync = (): void => {
  started = false;
  inFlight = null;
  again = false;
  if (retry !== null) clearTimeout(retry);
  retry = null;
  lastSigned = null;
  owedSeen = 0;
};
