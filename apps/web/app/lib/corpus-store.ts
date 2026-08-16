import type { Cursors } from "@openspecs/nostr";
import type { SearchDoc } from "./search";

/**
 * Where the corpus waits between visits, so a reader who has already searched
 * once does not download every document again to search a second time.
 *
 * A deletion is not carried: nothing here reacts to a kind 5, so a document its
 * author retracted stays searchable until this store is dropped. Relays are the
 * source of truth, and this is a cache that admits it.
 */
const DB = "openspecs";
const VERSION = 1;
const DOCS = "docs";
const CURSORS = "cursors";

export type Stored = { docs: SearchDoc[]; cursors: Cursors };

export const EMPTY: Stored = { docs: [], cursors: {} };

const coordinateOf = (doc: SearchDoc): string => `${doc.pubkey}:${doc.identifier}`;

/**
 * Addressable events replace each other, so two documents sharing a coordinate
 * are one document twice and the newest revision is the live one.
 */
export const mergeDocs = (existing: SearchDoc[], incoming: SearchDoc[]): SearchDoc[] => {
  const live = new Map<string, SearchDoc>();
  for (const doc of [...existing, ...incoming]) {
    const key = coordinateOf(doc);
    const current = live.get(key);
    if (!current || doc.revisedAt > current.revisedAt) live.set(key, doc);
  }
  return [...live.values()];
};

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS);
      if (!db.objectStoreNames.contains(CURSORS)) db.createObjectStore(CURSORS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const done = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const asked = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Storage is an accelerator, never a dependency: private browsing, a quota, a
 * disabled API or a corrupt database all mean the same thing here, a corpus
 * read from the relays instead of from disk.
 */
const available = (): boolean => typeof indexedDB !== "undefined";

export const readStored = async (): Promise<Stored> => {
  if (!available()) return EMPTY;
  try {
    const db = await open();
    try {
      const transaction = db.transaction([DOCS, CURSORS], "readonly");
      const docs = asked(transaction.objectStore(DOCS).getAll() as IDBRequest<SearchDoc[]>);
      const cursors = asked(transaction.objectStore(CURSORS).get("all") as IDBRequest<Cursors>);
      return { docs: (await docs) ?? [], cursors: (await cursors) ?? {} };
    } finally {
      db.close();
    }
  } catch {
    return EMPTY;
  }
};

export const writeStored = async (docs: SearchDoc[], cursors: Cursors): Promise<void> => {
  if (!available()) return;
  try {
    const db = await open();
    try {
      const transaction = db.transaction([DOCS, CURSORS], "readwrite");
      const store = transaction.objectStore(DOCS);
      // Rewritten whole rather than diffed: the corpus is already in memory, and
      // a full rewrite is what drops the revisions a merge superseded.
      store.clear();
      for (const doc of docs) store.put(doc, coordinateOf(doc));
      transaction.objectStore(CURSORS).put(cursors, "all");
      await done(transaction);
    } finally {
      db.close();
    }
  } catch {}
};

export const clearStored = async (): Promise<void> => {
  if (!available()) return;
  try {
    const db = await open();
    try {
      const transaction = db.transaction([DOCS, CURSORS], "readwrite");
      transaction.objectStore(DOCS).clear();
      transaction.objectStore(CURSORS).clear();
      await done(transaction);
    } finally {
      db.close();
    }
  } catch {}
};
