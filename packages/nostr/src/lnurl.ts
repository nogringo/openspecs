import { bech32 } from "@scure/base";
import { z } from "zod";
import type { NostrEvent } from "./event";

export const LNURL_TIMEOUT_MS = 4000;

/** A lightning address is an email-shaped name, and nothing more permissive. */
const ADDRESS = /^[a-z0-9\-_.]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export type PayEndpoint = {
  /** Where the invoice is asked for. */
  callback: string;
  minSendable: number;
  maxSendable: number;
  /** False when the server pays but will not sign a zap receipt. */
  allowsNostr: boolean;
  /** The key the receipt will be signed with, which is what proves it genuine. */
  nostrPubkey: string | null;
  /** How long a comment the server accepts, zero meaning none. */
  commentAllowed: number;
};

/**
 * `lud16` is a lightning address, `lud06` a bech32 `lnurl`. Both end at an https
 * URL serving the same document, so both are resolved to one here.
 */
export const payUrl = (lud16: string | null, lud06: string | null): string | null => {
  const address = (lud16 ?? "")
    .trim()
    .toLowerCase()
    .replace(/^lightning:/, "");
  if (ADDRESS.test(address)) {
    const [name, domain] = address.split("@");
    return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name ?? "")}`;
  }

  const encoded = (lud06 ?? "")
    .trim()
    .toLowerCase()
    .replace(/^lightning:/, "");
  if (!encoded.startsWith("lnurl1")) return null;
  try {
    const { words } = bech32.decode(encoded as `${string}1${string}`, 2000);
    const url = new URL(new TextDecoder().decode(bech32.fromWords(words)));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const endpointSchema = z.object({
  callback: z.string(),
  minSendable: z.number().optional(),
  maxSendable: z.number().optional(),
  allowsNostr: z.boolean().optional(),
  nostrPubkey: z.string().optional(),
  commentAllowed: z.number().optional(),
});

/** One satoshi, and a hundred thousand of them: the bounds a server may not widen. */
const MIN_MSATS = 1000;
const MAX_MSATS = 100_000_000_000;

const clamp = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;

/**
 * The address comes from a profile, which is a stranger's text, so the request
 * this makes on the reader's behalf follows the rules `resolveNip05` already
 * follows: https only, a short timeout, and no local hostname.
 */
export const fetchPayEndpoint = async (
  lud16: string | null,
  lud06: string | null = null,
  options: { timeoutMs?: number } = {},
): Promise<PayEndpoint | null> => {
  const url = payUrl(lud16, lud06);
  if (url === null) return null;

  const host = new URL(url).hostname;
  if (host === "localhost" || host.endsWith(".local")) return null;

  try {
    const response = await fetch(url, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? LNURL_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const parsed = endpointSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    const callback = new URL(parsed.data.callback);
    if (callback.protocol !== "https:") return null;

    const nostrPubkey = (parsed.data.nostrPubkey ?? "").trim().toLowerCase();
    return {
      callback: callback.toString(),
      minSendable: clamp(parsed.data.minSendable, MIN_MSATS),
      maxSendable: clamp(parsed.data.maxSendable, MAX_MSATS),
      // A server that will not sign a receipt can still be paid, but the payment
      // leaves no record on Nostr, so a zap button must not pretend otherwise.
      allowsNostr: parsed.data.allowsNostr === true && HEX_64.test(nostrPubkey),
      nostrPubkey: HEX_64.test(nostrPubkey) ? nostrPubkey : null,
      commentAllowed: clamp(parsed.data.commentAllowed, 0),
    };
  } catch {
    return null;
  }
};

const invoiceSchema = z.object({
  pr: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
});

export type InvoiceRequest = {
  endpoint: PayEndpoint;
  amountMsats: number;
  /** The signed kind 9734. The server embeds it in the receipt it publishes. */
  zapRequest: NostrEvent;
};

/**
 * Returns the bolt11 the recipient's server issued, or the words it refused
 * with. A refusal is worth reading: it usually says the amount is out of bounds.
 */
export const fetchInvoice = async (
  request: InvoiceRequest,
  options: { timeoutMs?: number } = {},
): Promise<{ invoice: string } | { error: string }> => {
  const url = new URL(request.endpoint.callback);
  url.searchParams.set("amount", String(Math.round(request.amountMsats)));
  url.searchParams.set("nostr", JSON.stringify(request.zapRequest));

  try {
    const response = await fetch(url, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? LNURL_TIMEOUT_MS),
    });
    const parsed = invoiceSchema.safeParse(await response.json());
    if (!parsed.success)
      return { error: "the server answered with something that is not an invoice" };

    const invoice = (parsed.data.pr ?? "").trim();
    if (invoice === "" || parsed.data.status === "ERROR") {
      return { error: parsed.data.reason?.trim() || "the server issued no invoice" };
    }
    return { invoice };
  } catch {
    return { error: "the server could not be reached" };
  }
};
