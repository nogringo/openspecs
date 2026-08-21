/**
 * A Nostr Wallet Connect client, NIP-47.
 *
 * Hand written rather than taken from nostr-tools, whose `nip47` is absent from
 * that package's exports map and reachable only through the barrel that pulls in
 * every other NIP, and which covers `pay_invoice` over NIP-04 alone with no
 * handling of what comes back.
 *
 * This module publishes. It runs in a browser and nowhere else, and no
 * `.server.ts` may import it.
 */
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent } from "nostr-tools/pure";
import { hexToBytes, isHex32 } from "nostr-tools/utils";
import { z } from "zod";
import { type NostrEvent, nostrEventSchema } from "./event";
import { queryRelays, type RelayOptions, relayPool, relaySet } from "./pool";

export const WALLET_INFO_KIND = 13194;
export const WALLET_REQUEST_KIND = 23194;
export const WALLET_RESPONSE_KIND = 23195;

/** A wallet may be asking a person to approve, and people are slow. */
const CALL_TIMEOUT_MS = 60_000;
const INFO_TIMEOUT_MS = 4000;
const INFO_TTL_MS = 10 * 60 * 1000;

export type WalletConnection = {
  /** The wallet service's own key. */
  walletPubkey: string;
  relays: string[];
  /** This connection's key. Whoever holds it can spend what the wallet allows. */
  secret: string;
  lud16: string | null;
};

/**
 * Parsed by hand rather than with `new URL`. A custom scheme's authority is
 * lowercased and otherwise mangled differently by different engines, and one of
 * them would happily accept an authority that is not a key at all.
 *
 * Returns null for anything malformed, the same total contract `parseCoordinate`
 * and `parseRelayList` keep.
 */
export const parseWalletConnect = (input: string): WalletConnection | null => {
  const value = input.trim().replace(/^nostr\+walletconnect:(\/\/)?/i, "");
  if (value === input.trim()) return null;

  const [head = "", tail = ""] = value.split("?", 2);
  const walletPubkey = head.trim().toLowerCase();
  if (!isHex32(walletPubkey)) return null;

  const params = new URLSearchParams(tail);
  // Repeatable by the spec, and comma joined by more than one wallet in the wild.
  const relays = relaySet(params.getAll("relay").flatMap((relay) => relay.split(",")));
  if (relays.length === 0) return null;

  const secret = (params.get("secret") ?? "").trim().toLowerCase();
  if (!isHex32(secret)) return null;

  return { walletPubkey, relays, secret, lud16: params.get("lud16")?.trim() || null };
};

export type WalletEncryption = "nip44_v2" | "nip04";

export type WalletInfo = {
  /** What the wallet says it can do. Used to grey a control, never to refuse a call. */
  methods: string[];
  encryption: WalletEncryption;
};

/** NIP-04 is what every wallet still understands, so it is what an unknown one gets. */
export const pickEncryption = (event: NostrEvent | null): WalletEncryption => {
  const said = event?.tags.find((tag) => tag[0] === "encryption")?.[1] ?? "";
  return said.split(/\s+/).includes("nip44_v2") ? "nip44_v2" : "nip04";
};

const cache = new Map<string, { expiresAt: number; info: Promise<WalletInfo> }>();

export const clearWalletInfoCache = (): void => cache.clear();

/**
 * What the wallet publishes about itself. A wallet that says nothing is assumed
 * to speak NIP-04 and is called anyway: refusing to pay because a metadata event
 * was slow is a worse failure than trying and being told no.
 */
export const fetchWalletInfo = (
  connection: WalletConnection,
  options: RelayOptions = {},
): Promise<WalletInfo> => {
  const now = Date.now();
  const cached = cache.get(connection.walletPubkey);
  if (cached && cached.expiresAt > now) return cached.info;

  const info = queryRelays(
    connection.relays,
    { kinds: [WALLET_INFO_KIND], authors: [connection.walletPubkey], limit: 1 },
    { ...options, timeoutMs: options.timeoutMs ?? INFO_TIMEOUT_MS },
  )
    .then((events) => {
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
      return {
        methods: (newest?.content ?? "").trim().split(/\s+/).filter(Boolean),
        encryption: pickEncryption(newest),
      };
    })
    .catch(() => ({ methods: [], encryption: "nip04" as const }));

  cache.set(connection.walletPubkey, { expiresAt: now + INFO_TTL_MS, info });
  return info;
};

/** The wallet's own words, or ours when the failure never reached it. */
export class WalletError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

const responseSchema = z.object({
  result_type: z.string().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullish(),
  result: z.record(z.string(), z.unknown()).nullish(),
});

const encrypted = (
  payload: string,
  connection: WalletConnection,
  encryption: WalletEncryption,
): string =>
  encryption === "nip44_v2"
    ? nip44.encrypt(
        payload,
        nip44.getConversationKey(hexToBytes(connection.secret), connection.walletPubkey),
      )
    : nip04.encrypt(connection.secret, connection.walletPubkey, payload);

/**
 * Decrypted with the scheme the answer names, then with the one the question
 * used, then with the other: wallets disagree about which of the two they answer
 * in, and an answer nobody can read is a payment whose outcome is unknown.
 */
const decrypted = (
  event: NostrEvent,
  connection: WalletConnection,
  sent: WalletEncryption,
): string | null => {
  const named = event.tags.find((tag) => tag[0] === "encryption")?.[1];
  const order: WalletEncryption[] =
    named === "nip44_v2" || named === "nip04"
      ? [named, named === "nip04" ? "nip44_v2" : "nip04"]
      : [sent, sent === "nip04" ? "nip44_v2" : "nip04"];

  for (const scheme of order) {
    try {
      return scheme === "nip44_v2"
        ? nip44.decrypt(
            event.content,
            nip44.getConversationKey(hexToBytes(connection.secret), event.pubkey),
          )
        : nip04.decrypt(connection.secret, event.pubkey, event.content);
    } catch {}
  }
  return null;
};

export type PaidInvoice = { preimage: string; feesPaid: number | null };

export type CallOptions = RelayOptions & {
  info?: WalletInfo;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * One question to a wallet, one answer back.
 *
 * The subscription is opened **before** the request is published, and that
 * ordering is the whole reliability of this module: a wallet sharing a relay
 * with us answers in tens of milliseconds, and subscribing afterwards loses that
 * answer and reports a timeout on a payment that has already been made.
 */
export const callWallet = async (
  connection: WalletConnection,
  method: string,
  params: Record<string, unknown>,
  options: CallOptions = {},
): Promise<Record<string, unknown>> => {
  const info = options.info ?? (await fetchWalletInfo(connection, options));
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  const now = Math.floor(Date.now() / 1000);

  const request = finalizeEvent(
    {
      kind: WALLET_REQUEST_KIND,
      created_at: now,
      content: encrypted(JSON.stringify({ method, params }), connection, info.encryption),
      tags: [
        ["p", connection.walletPubkey],
        ...(info.encryption === "nip44_v2" ? [["encryption", "nip44_v2"]] : []),
        // A request the wallet never saw must not be executed an hour later.
        ["expiration", String(now + Math.ceil(timeoutMs / 1000) + 60)],
      ],
    },
    hexToBytes(connection.secret),
  );

  const pool = options.pool ?? relayPool();
  const relays = relaySet(connection.relays);

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", cancel);
      subscription.close();
      settle();
    };

    const cancel = () =>
      finish(() => reject(new WalletError("the payment was called off", "ABORTED")));

    const deadline = setTimeout(
      () => finish(() => reject(new WalletError("the wallet did not answer", "TIMEOUT"))),
      timeoutMs,
    );

    const subscription = pool.subscribe(
      relays,
      {
        kinds: [WALLET_RESPONSE_KIND],
        authors: [connection.walletPubkey],
        "#e": [request.id],
      },
      {
        onevent: (event) => {
          const parsed = nostrEventSchema.safeParse(event);
          if (!parsed.success) return;

          const plain = decrypted(parsed.data, connection, info.encryption);
          if (plain === null) {
            return finish(() =>
              reject(new WalletError("the wallet's answer could not be read", "MALFORMED")),
            );
          }

          let answer: z.infer<typeof responseSchema>;
          try {
            const shape = responseSchema.safeParse(JSON.parse(plain));
            if (!shape.success) throw new Error("shape");
            answer = shape.data;
          } catch {
            return finish(() =>
              reject(new WalletError("the wallet answered with something else", "MALFORMED")),
            );
          }

          if (answer.error) {
            // The wallet's own words, and only those: a message this app writes
            // over them is a guess about somebody else's money.
            return finish(() =>
              reject(
                new WalletError(
                  answer.error?.message?.trim() || "the wallet refused",
                  answer.error?.code ?? "REFUSED",
                ),
              ),
            );
          }
          if (answer.result_type !== undefined && answer.result_type !== method) return;
          finish(() => resolve(answer.result ?? {}));
        },
      },
    );

    options.signal?.addEventListener("abort", cancel);
    if (options.signal?.aborted === true) return cancel();

    // Published last, on purpose. See above.
    for (const publishing of pool.publish(relays, request)) publishing.catch(() => {});
  });
};

const paidSchema = z.object({
  preimage: z.string(),
  fees_paid: z.number().nullish(),
});

/** The one call this app makes. */
export const payInvoice = async (
  connection: WalletConnection,
  invoice: string,
  options: CallOptions = {},
): Promise<PaidInvoice> => {
  const result = await callWallet(connection, "pay_invoice", { invoice }, options);
  const paid = paidSchema.safeParse(result);
  if (!paid.success) throw new WalletError("the wallet paid but said nothing useful", "MALFORMED");
  return { preimage: paid.data.preimage, feesPaid: paid.data.fees_paid ?? null };
};
