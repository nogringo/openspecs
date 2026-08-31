import { type EventDraft, firstTag, nostrEventSchema, tagValue } from "./event";
import { CLIENT_NAME } from "./nip22";

export const REPORT_KIND = 1984;

/** NIP-56's own words for what is wrong, in the order a form offers them. */
export const REPORT_TYPES = [
  "spam",
  "illegal",
  "nudity",
  "profanity",
  "malware",
  "impersonation",
  "other",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export type ReportTarget = {
  pubkey: string;
  /** The event, when the report is about one rather than about the key itself. */
  id?: string | null;
  /** A document's address, which outlives the revision `id` names. */
  coordinate?: string | null;
};

/**
 * The type sits on the tag naming what is reported, as NIP-56 asks: on the `e`
 * of a note, on the `p` of an account. No `k` tag: NIP-56 defines none, and a
 * document's kind is already in its `a`.
 */
export const buildReport = (target: ReportTarget, type: ReportType, content = ""): EventDraft => {
  const id = target.id?.trim();
  const coordinate = target.coordinate?.trim();

  return {
    kind: REPORT_KIND,
    content: content.trim(),
    tags: id
      ? [
          ["e", id, type],
          ...(coordinate ? [["a", coordinate]] : []),
          ["p", target.pubkey],
          ["client", CLIENT_NAME],
        ]
      : [
          ["p", target.pubkey, type],
          ["client", CLIENT_NAME],
        ],
  };
};

export type Report = {
  id: string;
  pubkey: string;
  createdAt: number;
  /** Whatever the third field said, kept even when it is not one of `REPORT_TYPES`. */
  type: string;
  reportedPubkey: string;
  targetId: string | null;
  targetCoordinate: string | null;
  content: string;
};

export const parseReport = (input: unknown): Report | null => {
  const parsed = nostrEventSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== REPORT_KIND) return null;

  const event = parsed.data;
  const reportedPubkey = tagValue(event, "p");
  if (reportedPubkey === "") return null;

  const target = firstTag(event, "e");
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    type: (target?.[2] ?? firstTag(event, "p")?.[2] ?? "").trim(),
    reportedPubkey,
    targetId: (target?.[1] ?? "").trim() || null,
    targetCoordinate: tagValue(event, "a") || null,
    content: event.content.trim(),
  };
};
