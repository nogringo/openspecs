import { type NostrEvent, nostrEventSchema } from "@openspecs/nostr";
import { publishTo, transient } from "./publish";

const OUTBOX_KEY = "openspecs:outbox";

export const OUTBOX_VERSION = 1;

/** A relay gets a day of tries. One that is down for a day is not being written to. */
const MAX_AGE_S = 24 * 60 * 60;

/** How long after a round that left something behind the next one is tried. */
const RETRY_MS = 60_000;

/** A signed event and the relays that have not taken it yet. */
export type Parcel = { event: NostrEvent; relays: string[]; since: number };

const store = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

export const parseOutbox = (input: unknown): Parcel[] => {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  if (record.v !== OUTBOX_VERSION || !Array.isArray(record.parcels)) return [];

  const parcels: Parcel[] = [];
  for (const item of record.parcels as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const parcel = item as Record<string, unknown>;
    const event = nostrEventSchema.safeParse(parcel.event);
    if (!event.success || !Array.isArray(parcel.relays)) continue;
    if (typeof parcel.since !== "number" || !Number.isFinite(parcel.since)) continue;
    const relays = parcel.relays.filter((relay): relay is string => typeof relay === "string");
    if (relays.length === 0) continue;
    parcels.push({ event: event.data, relays, since: Math.floor(parcel.since) });
  }
  return parcels;
};

/**
 * Held in memory and written through: a browser that refuses storage still
 * delivers what was signed in this tab, and one that allows it delivers what
 * was signed in the last.
 */
let parcels: Parcel[] = [];
let loaded = false;
let started = false;
let flushing: Promise<void> | null = null;
let again = false;
let retry: ReturnType<typeof setTimeout> | null = null;

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const raw = store()?.getItem(OUTBOX_KEY);
    parcels = raw === null || raw === undefined ? [] : parseOutbox(JSON.parse(raw));
  } catch {
    parcels = [];
  }
};

const save = (): void => {
  try {
    if (parcels.length === 0) store()?.removeItem(OUTBOX_KEY);
    else store()?.setItem(OUTBOX_KEY, JSON.stringify({ v: OUTBOX_VERSION, parcels }));
  } catch {}
};

const online = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** What is still owed, in the order it was signed. */
export const pendingParcels = (): Parcel[] => {
  load();
  return parcels;
};

/** The relays that still have not taken it after this round. */
const deliver = async (parcel: Parcel): Promise<string[]> => {
  const owed = new Set(parcel.relays);
  try {
    await publishTo(parcel.event, parcel.relays, (result) => {
      if (!transient(result)) owed.delete(result.relay);
    });
  } catch {}
  return parcel.relays.filter((relay) => owed.has(relay));
};

const round = async (): Promise<void> => {
  const now = nowSeconds();
  parcels = parcels.filter((parcel) => now - parcel.since < MAX_AGE_S);
  save();
  for (const parcel of [...parcels]) {
    parcel.relays = await deliver(parcel);
  }
  parcels = parcels.filter((parcel) => parcel.relays.length > 0);
  save();
};

/**
 * One round at a time. A parcel signed mid-round sets `again`, so it follows
 * the round rather than waiting for the retry.
 */
export const flush = (): Promise<void> => {
  load();
  if (typeof window === "undefined" || parcels.length === 0 || !online()) {
    return Promise.resolve();
  }
  if (flushing !== null) return flushing;

  flushing = round().then(() => {
    flushing = null;
    if (again) {
      again = false;
      void flush();
      return;
    }
    if (parcels.length > 0 && retry === null) {
      retry = setTimeout(() => {
        retry = null;
        void flush();
      }, RETRY_MS);
    }
  });
  return flushing;
};

/**
 * Written down before the first relay is tried: a tab closed a second after the
 * click still has the event, and the next visit sends it.
 */
export const enqueue = (event: NostrEvent, relays: string[]): void => {
  load();
  if (relays.length === 0 || parcels.some((parcel) => parcel.event.id === event.id)) return;
  parcels.push({ event, relays, since: nowSeconds() });
  save();
  if (flushing !== null) again = true;
  else void flush();
};

/** Called once per page load, from the frame every page shares. */
export const startOutbox = (): void => {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void flush());
  void flush();
};

export const clearOutbox = (): void => {
  parcels = [];
  loaded = false;
  started = false;
  flushing = null;
  again = false;
  if (retry !== null) clearTimeout(retry);
  retry = null;
  try {
    store()?.removeItem(OUTBOX_KEY);
  } catch {}
};
