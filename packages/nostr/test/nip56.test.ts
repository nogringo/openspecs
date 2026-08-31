import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { type NostrEvent, SPEC_KIND } from "../src/event";
import { buildReport, parseReport, REPORT_KIND } from "../src/nip56";

const AUTHOR = "b22b06b051fd5232966a9344a634d956c3dc33a7f5ecdcad9ed11ddc4120a7f2";
const COORDINATE = `${SPEC_KIND}:${AUTHOR}:replaceable-event-snapshots`;
const DOCUMENT = { pubkey: AUTHOR, id: "d".repeat(64), coordinate: COORDINATE };
const COMMENT = { pubkey: "f".repeat(64), id: "e".repeat(64) };

const secret = generateSecretKey();
const reporter = getPublicKey(secret);

const signed = (draft: { kind: number; content: string; tags: string[][] }) =>
  finalizeEvent({ ...draft, created_at: 1_700_000_000 }, secret) as NostrEvent;

describe("buildReport", () => {
  it("puts the type on the note and names its author and its address on a document", () => {
    expect(buildReport(DOCUMENT, "spam").tags).toEqual([
      ["e", DOCUMENT.id, "spam"],
      ["a", COORDINATE],
      ["p", AUTHOR],
      ["client", "Open Specs"],
    ]);
  });

  it("carries no address on a comment, which has none", () => {
    expect(buildReport(COMMENT, "profanity").tags).toEqual([
      ["e", COMMENT.id, "profanity"],
      ["p", COMMENT.pubkey],
      ["client", "Open Specs"],
    ]);
  });

  it("puts the type on the key when the report is about the account", () => {
    expect(buildReport({ pubkey: AUTHOR }, "impersonation").tags).toEqual([
      ["p", AUTHOR, "impersonation"],
      ["client", "Open Specs"],
    ]);
  });

  it("passes the words through trimmed, and sends none by default", () => {
    expect(buildReport(COMMENT, "other").content).toBe("");
    expect(buildReport(COMMENT, "other", "  says it is a wallet, is not  ").content).toBe(
      "says it is a wallet, is not",
    );
  });

  it("carries no k tag, since NIP-56 defines none", () => {
    expect(buildReport(DOCUMENT, "spam").tags.some((tag) => tag[0] === "k")).toBe(false);
  });
});

describe("parseReport", () => {
  it("reads back each shape it writes", () => {
    const document = parseReport(signed(buildReport(DOCUMENT, "illegal", "why")));
    expect(document).toMatchObject({
      pubkey: reporter,
      type: "illegal",
      reportedPubkey: AUTHOR,
      targetId: DOCUMENT.id,
      targetCoordinate: COORDINATE,
      content: "why",
    });

    const comment = parseReport(signed(buildReport(COMMENT, "spam")));
    expect(comment).toMatchObject({
      type: "spam",
      reportedPubkey: COMMENT.pubkey,
      targetId: COMMENT.id,
      targetCoordinate: null,
    });

    const account = parseReport(signed(buildReport({ pubkey: AUTHOR }, "impersonation")));
    expect(account).toMatchObject({
      type: "impersonation",
      reportedPubkey: AUTHOR,
      targetId: null,
      targetCoordinate: null,
    });
  });

  it("keeps a type it has never heard of, which is the reporter's word", () => {
    const odd = signed({
      kind: REPORT_KIND,
      content: "",
      tags: [["p", AUTHOR, "plagiarism"]],
    });
    expect(parseReport(odd)?.type).toBe("plagiarism");
  });

  it("refuses another kind, and a report naming nobody", () => {
    expect(parseReport(signed({ kind: 1, content: "", tags: [["p", AUTHOR, "spam"]] }))).toBeNull();
    expect(
      parseReport(signed({ kind: REPORT_KIND, content: "", tags: [["e", COMMENT.id, "spam"]] })),
    ).toBeNull();
  });
});
