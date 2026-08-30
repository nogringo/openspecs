import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publishTo: vi.fn() }));

vi.mock("./publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./publish")>()),
  publishTo: mocks.publishTo,
}));

import type { NostrEvent } from "@openspecs/nostr";
import {
  clearOutbox,
  enqueue,
  flush,
  OUTBOX_VERSION,
  parseOutbox,
  pendingParcels,
  startOutbox,
} from "./outbox";
import type { RelayResult } from "./publish";

const KEY = "openspecs:outbox";

const fakeStorage = (broken = false): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => {
      if (broken) throw new Error("this browser is in a private window");
      return held.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.set(key, value);
    },
    removeItem: (key: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.delete(key);
    },
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

const event = (id: string): NostrEvent => ({
  id: id.padStart(64, "0"),
  pubkey: "1".repeat(64),
  created_at: 1_700_000_000,
  kind: 7,
  tags: [["e", "d".repeat(64)]],
  content: "+",
  sig: "c".repeat(128),
});

const A = "wss://a.example";
const B = "wss://b.example";
const C = "wss://c.example";

/** What each relay says. Anything unnamed accepts. */
let answers: Record<string, Partial<RelayResult>> = {};

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

const listening = new Map<string, () => void>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", {
    addEventListener: (name: string, handler: () => void) => listening.set(name, handler),
  });
  clearOutbox();
  listening.clear();
  answers = {};
  mocks.publishTo.mockReset();
  mocks.publishTo.mockImplementation(
    async (_event, relays: string[], onResult?: (result: RelayResult) => void) => {
      const results = relays.map((relay) => ({
        relay,
        accepted: true,
        message: "accepted",
        ...answers[relay],
      }));
      for (const result of results) onResult?.(result);
      return results;
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sentTo = () => mocks.publishTo.mock.calls.map((call) => call[1] as string[]);

describe("enqueue", () => {
  it("writes the parcel down before any relay is tried", () => {
    mocks.publishTo.mockReturnValue(new Promise(() => {}));
    enqueue(event("1"), [A, B]);

    expect(stored()).toEqual({
      v: OUTBOX_VERSION,
      parcels: [{ event: event("1"), relays: [A, B], since: 1_700_000_000 }],
    });
  });

  it("delivers, and forgets a parcel every relay has taken", async () => {
    enqueue(event("1"), [A, B]);
    await flush();

    expect(sentTo()).toEqual([[A, B]]);
    expect(pendingParcels()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps only the relays that were not there, and tries them again later", async () => {
    answers = { [B]: { accepted: false, message: "not reached" } };
    enqueue(event("1"), [A, B, C]);
    await flush();

    expect(pendingParcels().map((parcel) => parcel.relays)).toEqual([[B]]);
    expect(stored().parcels[0].relays).toEqual([B]);

    answers = {};
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentTo()).toEqual([[A, B, C], [B]]);
    expect(pendingParcels()).toEqual([]);
  });

  it("takes a refusal as an answer and a rate limit as a wait", async () => {
    answers = {
      [A]: { accepted: false, message: "blocked: not on this relay" },
      [B]: { accepted: false, message: "rate-limited: slow down" },
    };
    enqueue(event("1"), [A, B]);
    await flush();

    expect(pendingParcels().map((parcel) => parcel.relays)).toEqual([[B]]);
  });

  it("holds the same event once however often it is handed over", async () => {
    mocks.publishTo.mockReturnValue(new Promise(() => {}));
    enqueue(event("1"), [A]);
    enqueue(event("1"), [A, B]);
    expect(pendingParcels()).toHaveLength(1);
  });

  it("still delivers what this tab signed when storage is refused", async () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    clearOutbox();
    enqueue(event("1"), [A]);
    await flush();
    expect(sentTo()).toEqual([[A]]);
  });
});

describe("offline", () => {
  it("waits for the network and sends when it is back", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    startOutbox();
    enqueue(event("1"), [A]);
    await flush();
    expect(mocks.publishTo).not.toHaveBeenCalled();
    expect(stored().parcels).toHaveLength(1);

    vi.stubGlobal("navigator", { onLine: true });
    listening.get("online")?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTo()).toEqual([[A]]);
    expect(pendingParcels()).toEqual([]);
  });
});

describe("startOutbox", () => {
  it("sends what the last visit left behind", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: OUTBOX_VERSION,
        parcels: [{ event: event("1"), relays: [A], since: 1_700_000_000 }],
      }),
    );
    startOutbox();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTo()).toEqual([[A]]);
  });

  it("gives up on a parcel a day old", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: OUTBOX_VERSION,
        parcels: [{ event: event("1"), relays: [A], since: 1_700_000_000 - 24 * 60 * 60 }],
      }),
    );
    startOutbox();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.publishTo).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("runs one round at a time and follows it with the parcel signed meanwhile", async () => {
    let release: () => void = () => {};
    mocks.publishTo.mockImplementationOnce(
      (_event, relays: string[], onResult?: (result: RelayResult) => void) =>
        new Promise<RelayResult[]>((resolve) => {
          release = () => {
            const results = relays.map((relay) => ({ relay, accepted: true, message: "ok" }));
            for (const result of results) onResult?.(result);
            resolve(results);
          };
        }),
    );
    enqueue(event("1"), [A]);
    enqueue(event("2"), [B]);
    expect(mocks.publishTo).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTo()).toEqual([[A], [B]]);
    expect(pendingParcels()).toEqual([]);
  });
});

describe("parseOutbox", () => {
  it("keeps what it can read and drops the rest", () => {
    expect(
      parseOutbox({
        v: OUTBOX_VERSION,
        parcels: [
          { event: event("1"), relays: [A, 3], since: 5.7 },
          { event: { kind: 7 }, relays: [A], since: 5 },
          { event: event("2"), relays: [], since: 5 },
          "nonsense",
        ],
      }),
    ).toEqual([{ event: event("1"), relays: [A], since: 5 }]);
  });

  it("reads nothing from another version or from noise", () => {
    expect(parseOutbox({ v: 0, parcels: [] })).toEqual([]);
    expect(parseOutbox("not an outbox")).toEqual([]);
    expect(parseOutbox(null)).toEqual([]);
  });
});
