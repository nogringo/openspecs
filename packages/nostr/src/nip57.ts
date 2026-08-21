import { getSatoshisAmountFromBolt11 } from "nostr-tools/nip57";
import { type EventDraft, type NostrEvent, nostrEventSchema, tagValue } from "./event";
import { CLIENT_NAME } from "./nip22";

export const ZAP_REQUEST_KIND = 9734;
export const ZAP_RECEIPT_KIND = 9735;

export type ZapTarget = {
  /** Who is paid. Always present: a zap is addressed to a person first. */
  pubkey: string;
  /** The event being zapped, absent when zapping the person themselves. */
  eventId?: string | null;
  /** Present only for an addressable target, and it is what survives an edit. */
  coordinate?: string | null;
  kind?: number | null;
};

export type ZapRequestDraft = {
  target: ZapTarget;
  amountMsats: number;
  comment?: string;
  /** Where the recipient's server should publish the receipt. */
  relays: string[];
};

/**
 * Built here rather than through nostr-tools' `makeZapRequest`, which wants the
 * whole signed event it is zapping. This app holds a document's coordinate and
 * id but not its 15 kilobytes of JSON, and a comment and a document would then
 * take two different code paths to produce the same six tags.
 *
 * This event is never published to a relay: it is handed to the recipient's
 * LNURL server, which signs the receipt that is.
 */
export const buildZapRequest = (draft: ZapRequestDraft): EventDraft => {
  const { target } = draft;
  return {
    kind: ZAP_REQUEST_KIND,
    content: (draft.comment ?? "").trim(),
    tags: [
      ["relays", ...draft.relays],
      // Millisatoshis, as a string, and it must equal the query parameter the
      // callback is asked with or the server is entitled to refuse.
      ["amount", String(Math.round(draft.amountMsats))],
      ["p", target.pubkey],
      ...(target.eventId ? [["e", target.eventId]] : []),
      ...(target.coordinate ? [["a", target.coordinate]] : []),
      ...(target.kind === null || target.kind === undefined ? [] : [["k", String(target.kind)]]),
      ["client", CLIENT_NAME],
    ],
  };
};

export type ZapReceipt = {
  id: string;
  /** The recipient's LNURL server, which is who signed this. */
  pubkey: string;
  createdAt: number;
  amountSats: number;
  /** The invoice that was paid, which is what ties a receipt to a handed out one. */
  bolt11: string;
  /** Who paid, read from the request the server echoed back. */
  zapper: string | null;
  recipient: string | null;
  comment: string;
  targetId: string | null;
  targetCoordinate: string | null;
};

/**
 * The amount is taken from the invoice rather than from the request: the request
 * is what was asked for, the invoice is what was paid. A receipt whose two
 * numbers disagree is dropped, which is the one check a reader gets for free.
 *
 * It is not the whole of NIP-57 appendix F. Proving a receipt genuine also means
 * knowing the recipient's LNURL `nostrPubkey`, which costs an HTTP request per
 * author: `verifyZapReceipt` does it where that is already known, and a tally
 * drawn on a page does not.
 */
export const parseZapReceipt = (input: unknown): ZapReceipt | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== ZAP_RECEIPT_KIND) return null;

  const event = parsed.data;
  const bolt11 = tagValue(event, "bolt11");
  if (bolt11 === "") return null;

  let amountSats: number;
  try {
    amountSats = getSatoshisAmountFromBolt11(bolt11);
  } catch {
    return null;
  }
  if (!Number.isFinite(amountSats) || amountSats <= 0) return null;

  // A satoshi of slack: the request is written in millisatoshis and the invoice
  // is read back in satoshis, so an amount that is not a whole number of them
  // disagrees with itself by rounding alone. What this is looking for is a
  // receipt claiming a thousand satoshis over an invoice for one.
  const request = parseZapRequest(tagValue(event, "description"));
  if (request !== null) {
    const asked = Number(tagValue(request, "amount")) / 1000;
    if (Number.isFinite(asked) && asked > 0 && Math.abs(asked - amountSats) > 1) return null;
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    amountSats,
    bolt11,
    zapper: request?.pubkey ?? (tagValue(event, "P") || null),
    recipient: tagValue(event, "p") || null,
    comment: (request?.content ?? "").trim(),
    targetId: tagValue(event, "e") || null,
    targetCoordinate: tagValue(event, "a") || null,
  };
};

/** The request the server echoes back in `description`, as JSON. */
export const parseZapRequest = (description: string): NostrEvent | null => {
  if (description.trim() === "") return null;
  try {
    const parsed = nostrEventSchema.safeParse(JSON.parse(description));
    return parsed.success && parsed.data.kind === ZAP_REQUEST_KIND ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * The rest of appendix F, for the one moment it can be run: straight after a
 * payment, when the endpoint that issued the invoice is still in hand.
 */
export const verifyZapReceipt = (
  receipt: ZapReceipt,
  expected: { nostrPubkey: string; recipient: string; amountSats?: number },
): boolean =>
  receipt.pubkey === expected.nostrPubkey &&
  receipt.recipient === expected.recipient &&
  (expected.amountSats === undefined || receipt.amountSats === expected.amountSats);

/** What a document or a comment was zapped, which is the only number a tally shows. */
export const totalSats = (receipts: ZapReceipt[]): number => {
  const unique = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  let total = 0;
  for (const receipt of unique.values()) total += receipt.amountSats;
  return total;
};
