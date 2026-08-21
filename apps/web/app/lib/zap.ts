import type { PayEndpoint, ZapTarget } from "@openspecs/nostr";
import { buildZapRequest, fetchInvoice, fetchPayEndpoint, payInvoice } from "@openspecs/nostr";
import type { Author } from "./profile";
import { zapReceiptRelays } from "./relays";
import { signer } from "./session";
import { wallet } from "./wallet";

/** What the presets offer, and the sums a reader is likely to mean. */
export const PRESETS = [21, 210, 2_100, 21_000];

export type ZapQuote = {
  /** The bolt11 to pay, however the reader chooses to pay it. */
  invoice: string;
  endpoint: PayEndpoint;
  sats: number;
};

/**
 * Whether a page can offer to pay somebody at all. An author who published no
 * lightning address cannot be zapped, and a button that says otherwise is a
 * button that fails after three clicks and a signature.
 */
export const canBeZapped = (author: Author | null): boolean =>
  author !== null && (author.lud16 !== null || author.lud06 !== null);

/**
 * Everything before the money moves: find where they are paid, sign the request
 * that will become the public receipt, and take back an invoice.
 *
 * The kind 9734 is never published to a relay. It is handed to the recipient's
 * own server, which signs the kind 9735 that is, so this signature is what ties
 * a payment to a reader without either of them telling this site anything.
 */
export const quoteZap = async (
  me: string,
  author: Author,
  target: ZapTarget,
  sats: number,
  comment = "",
): Promise<ZapQuote> => {
  const endpoint = await fetchPayEndpoint(author.lud16, author.lud06);
  if (endpoint === null) throw new Error("that address does not answer");
  if (!endpoint.allowsNostr) {
    throw new Error("their wallet takes payments but will not sign a receipt");
  }

  const amountMsats = sats * 1000;
  if (amountMsats < endpoint.minSendable || amountMsats > endpoint.maxSendable) {
    throw new Error(
      `their wallet takes between ${Math.ceil(endpoint.minSendable / 1000)} and ${Math.floor(endpoint.maxSendable / 1000)} sats`,
    );
  }

  const relays = await zapReceiptRelays(me, target.pubkey);
  const draft = buildZapRequest({
    target,
    amountMsats,
    // Only as much as the server said it would carry, and only if it said any.
    comment: endpoint.commentAllowed > 0 ? comment.slice(0, endpoint.commentAllowed) : "",
    relays,
  });

  const ready = await signer();
  const request = await ready.signEvent({ ...draft, created_at: Math.floor(Date.now() / 1000) });

  const invoice = await fetchInvoice({ endpoint, amountMsats, zapRequest: request });
  if ("error" in invoice) throw new Error(invoice.error);
  return { invoice: invoice.invoice, endpoint, sats };
};

export type PaidBy = "webln" | "wallet";

type Webln = { enable: () => Promise<void>; sendPayment: (invoice: string) => Promise<unknown> };

const webln = (): Webln | null => {
  const found = (globalThis as { webln?: Webln }).webln;
  return found === undefined ? null : found;
};

/** Whether anything on this device can pay without the reader leaving the page. */
export const canPayHere = (): boolean => webln() !== null || wallet() !== null;

/**
 * Paid by whatever is here, in the order of how little it asks: a browser wallet
 * that is already unlocked, then a connected one over NIP-47. Neither being
 * present is not a failure, it is the invoice being the reader's to carry.
 */
export const payHere = async (invoice: string, signal?: AbortSignal): Promise<PaidBy> => {
  const inPage = webln();
  if (inPage !== null) {
    await inPage.enable();
    await inPage.sendPayment(invoice);
    return "webln";
  }

  const connected = wallet();
  if (connected !== null) {
    await payInvoice(connected, invoice, { signal });
    return "wallet";
  }

  throw new Error("nothing on this device can pay an invoice");
};
