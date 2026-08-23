import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ publish: vi.fn(), destroy: vi.fn() }));
vi.mock("nostr-tools/pool", () => ({
  // Not an arrow: `new` on one throws, and this is constructed.
  SimplePool: function SimplePool() {
    return pool;
  },
}));

const session = vi.hoisted(() => ({ signer: vi.fn(), sessionState: vi.fn() }));
vi.mock("./session", () => session);

import { setNamesClient } from "./client-tag";
import { publishTo, signAndPublish, toResult } from "./publish";
import { SessionMismatch, SessionMissing } from "./signer";
import { keySigner } from "./signer-key";

const RELAY = "wss://a.example";
const RELAYS = ["wss://a.example", "wss://b.example"];
const DRAFT = { kind: 1111, content: "a comment", tags: [["A", "30817:x:y"]] };

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);

beforeEach(() => {
  pool.publish.mockReset();
  pool.destroy.mockReset();
  pool.publish.mockImplementation((relays: string[]) => relays.map(() => Promise.resolve("")));

  session.signer.mockReset();
  session.sessionState.mockReset();
  session.signer.mockResolvedValue(keySigner(secret));
  session.sessionState.mockReturnValue({ pubkey });

  setNamesClient(false);
});

afterEach(() => vi.restoreAllMocks());

describe("toResult", () => {
  it("reports an acceptance, worded even when the relay says nothing", () => {
    expect(toResult(RELAY, { status: "fulfilled", value: "" })).toEqual({
      relay: RELAY,
      accepted: true,
      message: "accepted",
    });
  });

  /**
   * The one answer that looks like a yes and is not: a relay nothing could even
   * open a socket to. Counting it as accepted told a reader with no network that
   * seven relays had taken what none of them had seen.
   */
  it("reports a relay it never reached as a refusal", () => {
    const settled = {
      status: "fulfilled",
      value: "connection failure: Error: connection failed",
    } as const;

    expect(toResult(RELAY, settled)).toEqual({
      relay: RELAY,
      accepted: false,
      message: "not reached",
    });
  });

  it("reports a refusal in the relay's own words", () => {
    expect(
      toResult(RELAY, { status: "rejected", reason: new Error("blocked: pubkey not admitted") }),
    ).toEqual({
      relay: RELAY,
      accepted: false,
      message: "blocked: pubkey not admitted",
    });
  });

  /**
   * The behaviour the case above is written against, read from the library
   * rather than assumed: a resolved publish is not a published event. Nothing
   * listens on the discard port, so this asks the real pool a local question and
   * fails the day nostr-tools words its answer differently.
   */
  it("is how nostr-tools really answers for a relay that cannot be opened", async () => {
    const { SimplePool } =
      await vi.importActual<typeof import("nostr-tools/pool")>("nostr-tools/pool");
    const real = new SimplePool();
    const signed = await keySigner(secret).signEvent({ ...DRAFT, created_at: 1_700_000_000 });

    const [answer] = await Promise.all(real.publish(["wss://127.0.0.1:9/"], signed));
    real.destroy();

    expect(answer).toMatch(/^connection failure:/);
    expect(toResult(RELAY, { status: "fulfilled", value: answer ?? "" }).accepted).toBe(false);
  });

  it("gives words to a relay that refuses without saying why", () => {
    for (const reason of [new Error(""), undefined, ""]) {
      expect(toResult(RELAY, { status: "rejected", reason }).message).toBe("refused");
    }
  });

  it("keeps what a relay says when it accepts with a comment", () => {
    expect(
      toResult(RELAY, { status: "fulfilled", value: "duplicate: already have this event" }),
    ).toMatchObject({ accepted: true, message: "duplicate: already have this event" });
  });
});

describe("publishTo", () => {
  it("reports every relay as it answers, and returns the lot", async () => {
    const seen: string[] = [];
    const results = await publishTo({ id: "x" }, RELAYS, (result) => seen.push(result.relay));

    expect(results.map((result) => result.relay).sort()).toEqual([...RELAYS].sort());
    expect(seen.sort()).toEqual([...RELAYS].sort());
    expect(pool.destroy).toHaveBeenCalled();
  });

  it("opens nothing when there is nowhere to send", async () => {
    expect(await publishTo({ id: "x" }, [])).toEqual([]);
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("keeps a relay's refusal beside the ones that accepted", async () => {
    pool.publish.mockImplementation(() => [
      Promise.resolve("accepted"),
      Promise.reject(new Error("blocked: pubkey not admitted")),
    ]);

    const results = await publishTo({ id: "x" }, RELAYS);
    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(results.find((result) => !result.accepted)?.message).toBe(
      "blocked: pubkey not admitted",
    );
  });
});

describe("signAndPublish", () => {
  it("signs the draft and sends exactly what it signed", async () => {
    const report = await signAndPublish(DRAFT, RELAYS);

    expect(report.event.kind).toBe(1111);
    expect(report.event.pubkey).toBe(pubkey);
    expect(report.event.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(report.accepted).toBe(2);
    expect(pool.publish).toHaveBeenCalledWith(RELAYS, report.event);
  });

  it("stamps the moment it was sent, unless one was chosen", async () => {
    expect((await signAndPublish(DRAFT, RELAYS)).event.created_at).toBeGreaterThan(1_700_000_000);
    expect(
      (await signAndPublish({ ...DRAFT, created_at: 1_700_000_000 }, RELAYS)).event.created_at,
    ).toBe(1_700_000_000);
  });

  /**
   * The builders name the app on everything, because the importer rewrites that
   * tag into its own name and has to find it. Whether it reaches a relay is
   * settled here instead, and the signature has to be taken over what is left.
   */
  it("signs away the app's name when nobody asked for it", async () => {
    const named = { ...DRAFT, tags: [...DRAFT.tags, ["client", "openspecs"]] };
    const report = await signAndPublish(named, RELAYS);

    expect(report.event.tags).toEqual([["A", "30817:x:y"]]);
  });

  it("keeps the app's name, in its place, when the reader asked for it", async () => {
    setNamesClient(true);
    const tags = [...DRAFT.tags, ["client", "openspecs"]];
    const report = await signAndPublish({ ...DRAFT, tags }, RELAYS);

    expect(report.event.tags).toEqual(tags);
  });

  /** The lookup runs while its author is looking at their signer's prompt. */
  it("takes a relay set that is still being resolved", async () => {
    expect((await signAndPublish(DRAFT, Promise.resolve(RELAYS))).accepted).toBe(2);
  });

  /**
   * Somebody who cancels in their extension must leave nothing on any relay, so
   * the socket is opened after the signature and not before it.
   */
  it("opens nothing when there is nobody to sign with", async () => {
    session.signer.mockRejectedValue(new SessionMissing());

    await expect(signAndPublish(DRAFT, RELAYS)).rejects.toBeInstanceOf(SessionMissing);
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("opens nothing when the signer refuses", async () => {
    session.signer.mockResolvedValue({
      getPublicKey: async () => pubkey,
      signEvent: async () => {
        throw new Error("user rejected");
      },
    });

    await expect(signAndPublish(DRAFT, RELAYS)).rejects.toThrow("user rejected");
    expect(pool.publish).not.toHaveBeenCalled();
  });

  /**
   * What a signer switched to another account underneath looks like. Publishing
   * it would file somebody else's signature under this session's name.
   */
  it("publishes nothing when the signature came back under another key", async () => {
    session.sessionState.mockReturnValue({ pubkey: "f".repeat(64) });

    await expect(signAndPublish(DRAFT, RELAYS)).rejects.toBeInstanceOf(SessionMismatch);
    expect(pool.publish).not.toHaveBeenCalled();
  });
});
