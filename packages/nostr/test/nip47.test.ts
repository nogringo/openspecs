import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { NostrEvent } from "../src/event";
import {
  callWallet,
  clearWalletInfoCache,
  fetchWalletInfo,
  parseWalletConnect,
  payInvoice,
  pickEncryption,
  WALLET_INFO_KIND,
  WALLET_RESPONSE_KIND,
  type WalletConnection,
  type WalletEncryption,
  WalletError,
} from "../src/nip47";

const walletKey = generateSecretKey();
const wallet = getPublicKey(walletKey);
const clientKey = generateSecretKey();

const INVOICE = "lnbc210n1pn2s396pp5w7lqvvmqxxwqmqjqxqyjqxqyjqxqyjqxqyjqxqyjqxqyjqxqyjqs";

describe("parseWalletConnect", () => {
  const connection = `nostr+walletconnect://${wallet}?relay=wss%3A%2F%2Frelay.example&secret=${bytesToHex(clientKey)}`;

  it("reads a connection string", () => {
    expect(parseWalletConnect(connection)).toEqual({
      walletPubkey: wallet,
      relays: ["wss://relay.example/"],
      secret: bytesToHex(clientKey),
      lud16: null,
    });
  });

  it("takes the form without the slashes, which wallets emit too", () => {
    expect(parseWalletConnect(connection.replace("://", ":"))?.walletPubkey).toBe(wallet);
  });

  it("takes every relay a wallet named, however it named them", () => {
    const repeated = `${connection}&relay=wss%3A%2F%2Fsecond.example`;
    expect(parseWalletConnect(repeated)?.relays).toHaveLength(2);

    const joined = connection.replace(
      "relay=wss%3A%2F%2Frelay.example",
      "relay=wss%3A%2F%2Fa.example%2Cwss%3A%2F%2Fb.example",
    );
    expect(parseWalletConnect(joined)?.relays).toHaveLength(2);
  });

  it("keeps a lightning address when one came with it", () => {
    expect(parseWalletConnect(`${connection}&lud16=me%40example.com`)?.lud16).toBe(
      "me@example.com",
    );
  });

  it("ignores parameters it has never heard of", () => {
    expect(parseWalletConnect(`${connection}&budget=daily`)?.secret).toBe(bytesToHex(clientKey));
  });

  it("refuses a string that is not one", () => {
    for (const junk of [
      "",
      "hunter2",
      `https://${wallet}?relay=wss://a.example&secret=${bytesToHex(clientKey)}`,
      `nostr+walletconnect://not-a-key?relay=wss://a.example&secret=${bytesToHex(clientKey)}`,
      `nostr+walletconnect://${wallet}?secret=${bytesToHex(clientKey)}`,
      `nostr+walletconnect://${wallet}?relay=wss://a.example`,
      `nostr+walletconnect://${wallet}?relay=wss://a.example&secret=short`,
    ]) {
      expect(parseWalletConnect(junk), junk).toBeNull();
    }
  });
});

const infoEvent = (encryption: string | null) =>
  finalizeEvent(
    {
      kind: WALLET_INFO_KIND,
      created_at: 1,
      content: "pay_invoice get_balance",
      tags: encryption === null ? [] : [["encryption", encryption]],
    },
    walletKey,
  );

describe("pickEncryption", () => {
  it("takes NIP-44 when the wallet offers it", () => {
    expect(pickEncryption(infoEvent("nip44_v2 nip04"))).toBe("nip44_v2");
  });

  it("falls back to what every wallet still understands", () => {
    expect(pickEncryption(infoEvent("nip04"))).toBe("nip04");
    expect(pickEncryption(infoEvent(null))).toBe("nip04");
    expect(pickEncryption(null)).toBe("nip04");
  });
});

/**
 * A wallet, in ten lines: it listens for a request, decrypts it, and answers.
 * Standing one up is the only way to test the ordering this module depends on.
 */
const runWallet = (
  relay: MockRelay,
  pool: SimplePool,
  answer: (method: string, params: Record<string, unknown>) => unknown,
  encryption: WalletEncryption = "nip04",
  delayMs = 0,
) =>
  pool.subscribe(
    [relay.url ?? ""],
    { kinds: [23194], "#p": [wallet] },
    {
      onevent: (event: NostrEvent) => {
        const key = nip44.getConversationKey(walletKey, event.pubkey);
        const plain =
          encryption === "nip44_v2"
            ? nip44.decrypt(event.content, key)
            : nip04.decrypt(walletKey, event.pubkey, event.content);
        const { method, params } = JSON.parse(plain);

        const reply = JSON.stringify(answer(method, params));
        const content =
          encryption === "nip44_v2"
            ? nip44.encrypt(reply, key)
            : nip04.encrypt(walletKey, event.pubkey, reply);

        const publish = () =>
          pool.publish(
            [relay.url ?? ""],
            finalizeEvent(
              {
                kind: WALLET_RESPONSE_KIND,
                created_at: Math.floor(Date.now() / 1000),
                content,
                tags: [
                  ["p", event.pubkey],
                  ["e", event.id],
                  ...(encryption === "nip44_v2" ? [["encryption", "nip44_v2"]] : []),
                ],
              },
              walletKey,
            ),
          );
        if (delayMs === 0) publish();
        else setTimeout(publish, delayMs);
      },
    },
  );

describe("talking to a wallet", () => {
  let relay: MockRelay;
  let pool: SimplePool;
  let connection: WalletConnection;

  beforeAll(async () => {
    relay = createMockRelay();
    await relay.start();
    pool = new SimplePool();
    connection = {
      walletPubkey: wallet,
      relays: [relay.url ?? ""],
      secret: bytesToHex(clientKey),
      lud16: null,
    };
  });

  afterEach(() => clearWalletInfoCache());

  afterAll(() => {
    pool.destroy();
    return relay.stop();
  });

  const info = (encryption: WalletEncryption) => ({ methods: ["pay_invoice"], encryption });

  it("reads what a wallet says about itself", async () => {
    relay.seed([infoEvent("nip44_v2 nip04")]);
    const said = await fetchWalletInfo(connection, { pool, timeoutMs: 2000 });

    expect(said.encryption).toBe("nip44_v2");
    expect(said.methods).toEqual(["pay_invoice", "get_balance"]);
  });

  for (const encryption of ["nip04", "nip44_v2"] as const) {
    it(`pays an invoice over ${encryption}`, async () => {
      const listening = runWallet(
        relay,
        pool,
        () => ({ result_type: "pay_invoice", result: { preimage: "ab".repeat(32), fees_paid: 1 } }),
        encryption,
      );
      try {
        const paid = await payInvoice(connection, INVOICE, {
          pool,
          info: info(encryption),
          timeoutMs: 4000,
        });
        expect(paid).toEqual({ preimage: "ab".repeat(32), feesPaid: 1 });
      } finally {
        listening.close();
      }
    });
  }

  /**
   * The reason the subscription is opened before the request is published. A
   * wallet on the same relay answers in milliseconds, and an answer that arrives
   * before anybody is listening is a payment whose outcome is never learned.
   */
  it("hears an answer that comes back at once", async () => {
    const listening = runWallet(relay, pool, () => ({
      result_type: "pay_invoice",
      result: { preimage: "cd".repeat(32) },
    }));
    try {
      const paid = await payInvoice(connection, INVOICE, {
        pool,
        info: info("nip04"),
        timeoutMs: 4000,
      });
      expect(paid.preimage).toBe("cd".repeat(32));
    } finally {
      listening.close();
    }
  });

  it("passes the wallet's refusal on in the wallet's own words", async () => {
    const listening = runWallet(relay, pool, () => ({
      result_type: "pay_invoice",
      error: { code: "INSUFFICIENT_BALANCE", message: "not enough sats" },
    }));
    try {
      await expect(
        payInvoice(connection, INVOICE, { pool, info: info("nip04"), timeoutMs: 4000 }),
      ).rejects.toMatchObject({ message: "not enough sats", code: "INSUFFICIENT_BALANCE" });
    } finally {
      listening.close();
    }
  });

  it("says so when the wallet answers with something else", async () => {
    const listening = runWallet(relay, pool, () => ({ nonsense: true }));
    try {
      await expect(
        payInvoice(connection, INVOICE, { pool, info: info("nip04"), timeoutMs: 4000 }),
      ).rejects.toMatchObject({ code: "MALFORMED" });
    } finally {
      listening.close();
    }
  });

  it("gives up on a wallet that never answers", async () => {
    await expect(
      callWallet(
        connection,
        "pay_invoice",
        { invoice: INVOICE },
        {
          pool,
          info: info("nip04"),
          timeoutMs: 300,
        },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("stops waiting when the payment is called off", async () => {
    const abort = new AbortController();
    const calling = callWallet(
      connection,
      "pay_invoice",
      { invoice: INVOICE },
      {
        pool,
        info: info("nip04"),
        timeoutMs: 4000,
        signal: abort.signal,
      },
    );
    const asserted = expect(calling).rejects.toMatchObject({ code: "ABORTED" });
    abort.abort();
    await asserted;
  });

  it("names a WalletError as one", () => {
    const error = new WalletError("not enough sats", "INSUFFICIENT_BALANCE");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("WalletError");
  });

  it("never puts the connection's key in what it throws", async () => {
    const listening = runWallet(relay, pool, () => ({ nonsense: true }));
    try {
      await payInvoice(connection, INVOICE, { pool, info: info("nip04"), timeoutMs: 4000 });
    } catch (reason) {
      const said = `${(reason as Error).message}${(reason as Error).stack ?? ""}`;
      expect(said).not.toContain(bytesToHex(clientKey));
    } finally {
      listening.close();
    }
  });
});

describe("the key it talks with", () => {
  it("is the connection's own, not the reader's", () => {
    const connection = parseWalletConnect(
      `nostr+walletconnect://${wallet}?relay=wss%3A%2F%2Fa.example&secret=${bytesToHex(clientKey)}`,
    );
    expect(connection?.secret).toBe(bytesToHex(clientKey));
    expect(getPublicKey(hexToBytes(connection?.secret ?? ""))).not.toBe(wallet);
  });
});
