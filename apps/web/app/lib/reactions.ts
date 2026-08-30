import {
  buildReaction,
  buildRetraction,
  DEFAULT_RELAYS,
  DISCUSSION_RELAYS,
  LIKE,
  type ReactionTally,
  type ReactionTarget,
  relaySet,
} from "@openspecs/nostr";
import {
  addToDiscussion,
  type DiscussionState,
  discussionState,
  subscribeDiscussionState,
} from "./discussion";
import { enqueue } from "./outbox";
import { signDraft } from "./publish";
import { writeRelays } from "./relays";

/** Which way a reader wants a symbol on a target, keyed by `reactionKey`. */
export type Intents = Record<string, boolean>;

export const NO_INTENTS: Intents = Object.freeze({});

/**
 * How long the record is waited for before a click is acted on against whatever
 * has arrived. Relays that never list what they hold, which is what being
 * offline looks like, must not be able to hold a click hostage.
 */
const PATIENCE_MS = 5000;

/** Where an event goes when no relay list could be read, which is also what offline looks like. */
const FALLBACK_RELAYS = relaySet(DISCUSSION_RELAYS, DEFAULT_RELAYS);

type Intent = {
  me: string;
  target: ReactionTarget;
  symbol: string;
  on: boolean;
  at: number;
};

export const reactionKey = (target: { id: string }, symbol: string): string =>
  `${target.id}:${symbol}`;

let intents = new Map<string, Intent>();
let snapshot: Intents = NO_INTENTS;
/** Keys with a signature being asked for. One at a time per key, or two clicks sign two likes. */
const inFlight = new Set<string>();
const lastSignedAt = new Map<string, number>();
let watching = false;

const listeners = new Set<() => void>();

export const subscribeIntents = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const intentsState = (): Intents => snapshot;

export const serverIntentsState = (): Intents => NO_INTENTS;

const notify = (): void => {
  snapshot = Object.fromEntries([...intents].map(([key, intent]) => [key, intent.on]));
  for (const listener of listeners) listener();
};

/** Null when the record on hand is not about this target at all. */
const talliesOf = (state: DiscussionState, target: ReactionTarget): ReactionTally[] | null => {
  if (target.coordinate) {
    return state.coordinate === target.coordinate ? state.document.reactions : null;
  }
  return state.byComment[target.id]?.reactions ?? null;
};

const mineIn = (tallies: ReactionTally[], symbol: string, me: string): string | undefined =>
  tallies.find((tally) => tally.symbol === symbol)?.by[me];

/**
 * The tallies as the reader sees them: what the relays hold, corrected by what
 * they clicked and the relays have not been told yet. A pending reaction has no
 * id, so it is marked with an empty one; nothing is ever retracted by it.
 */
export const withIntent = (
  tallies: ReactionTally[],
  me: string,
  target: { id: string },
  intents: Intents,
): ReactionTally[] => {
  let shown = tallies;
  const prefix = `${target.id}:`;
  for (const [key, on] of Object.entries(intents)) {
    if (!key.startsWith(prefix)) continue;
    const symbol = key.slice(prefix.length);
    const index = shown.findIndex((tally) => tally.symbol === symbol);
    const tally = shown[index];
    const has = tally !== undefined && tally.by[me] !== undefined;
    if (has === on) continue;

    if (tally === undefined) {
      const added = { symbol, emojiUrl: null, count: 1, by: { [me]: "" } };
      shown = symbol === LIKE ? [added, ...shown] : [...shown, added];
    } else if (on) {
      const next = { ...tally, count: tally.count + 1, by: { ...tally.by, [me]: "" } };
      shown = shown.map((each, at) => (at === index ? next : each));
    } else {
      const by = Object.fromEntries(Object.entries(tally.by).filter(([who]) => who !== me));
      const next = { ...tally, count: tally.count - 1, by };
      shown =
        next.count === 0
          ? shown.filter((_, at) => at !== index)
          : shown.map((each, at) => (at === index ? next : each));
    }
  }
  return shown;
};

const settle = async (key: string, intent: Intent, mine: string | undefined): Promise<void> => {
  const draft =
    mine === undefined ? buildReaction(intent.target, intent.symbol) : buildRetraction(mine);
  // A like, its retraction and a second like inside one second would share an
  // id, and a relay that honoured the retraction refuses that id for good.
  const at = Math.max(Math.floor(Date.now() / 1000), (lastSignedAt.get(key) ?? 0) + 1);

  try {
    const event = await signDraft({ ...draft, created_at: at });
    lastSignedAt.set(key, at);
    addToDiscussion(event);
    inFlight.delete(key);
    reconcile();

    // Nothing waits on the relays: the event exists, the outbox owes it to them.
    void writeRelays(intent.me, {
      addressed: [intent.target.pubkey],
      hints: intent.target.relay ? [intent.target.relay] : [],
    })
      .catch(() => FALLBACK_RELAYS)
      .then((relays) => enqueue(event, relays));
  } catch {
    // The signer said no. That is the one thing the screen has to take back.
    intents.delete(key);
    inFlight.delete(key);
    notify();
    reconcile();
  }
};

/**
 * What the reader wants against what the relays say, one signature per
 * difference. Run on every click and on every change to the record, so five
 * quick clicks sign only what it takes to land on the last one.
 */
function reconcile(): void {
  const state = discussionState();
  const now = Date.now();
  let changed = false;

  for (const [key, intent] of intents) {
    if (inFlight.has(key)) continue;
    const tallies = talliesOf(state, intent.target);
    if (tallies === null) {
      intents.delete(key);
      changed = true;
      continue;
    }
    if (state.status !== "ready" && now - intent.at < PATIENCE_MS) continue;

    const mine = mineIn(tallies, intent.symbol, intent.me);
    if ((mine !== undefined) === intent.on) {
      intents.delete(key);
      changed = true;
      continue;
    }
    inFlight.add(key);
    void settle(key, intent, mine);
  }

  if (changed) notify();
}

/** The click. The screen moves now; the signer and the relays are told after. */
export const setReaction = (
  me: string,
  target: ReactionTarget,
  symbol: string,
  on: boolean,
): void => {
  if (typeof window === "undefined") return;
  intents.set(reactionKey(target, symbol), { me, target, symbol, on, at: Date.now() });
  notify();

  if (!watching) {
    watching = true;
    subscribeDiscussionState(reconcile);
  }
  setTimeout(reconcile, PATIENCE_MS);
  reconcile();
};

export const clearReactions = (): void => {
  intents = new Map();
  snapshot = NO_INTENTS;
  inFlight.clear();
  lastSignedAt.clear();
  watching = false;
};
