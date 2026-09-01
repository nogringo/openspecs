import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  MAX_DRAFT_BYTES,
  parseStoredDraft,
  readDraft,
  type StoredDraft,
  writeDraft,
} from "./spec-draft-store";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);

const stored = (fields: Partial<StoredDraft["draft"]> = {}, rest: Partial<StoredDraft> = {}) =>
  ({
    v: 1,
    draft: {
      identifier: "a-document",
      title: "A document",
      summary: "",
      content: "# A document\n",
      status: "draft",
      topics: ["nostr"],
      kinds: [{ raw: "30817", name: "Custom NIP" }],
      ...fields,
    },
    savedAt: 1_700_000_000_000,
    basedOn: null,
    ...rest,
  }) satisfies StoredDraft;

/** A fake with the one behaviour that matters: it can be written to and read back. */
const fakeStorage = (broken = false): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.set(key, value);
    },
    removeItem: (key: string) => void held.delete(key),
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("parseStoredDraft", () => {
  it("reads back every field of a draft", () => {
    const record = stored();
    expect(parseStoredDraft(record)).toEqual(record);
  });

  it("refuses a record written by a version that is not this one", () => {
    expect(parseStoredDraft({ ...stored(), v: 2 })).toBeNull();
    expect(parseStoredDraft({ ...stored(), v: undefined })).toBeNull();
  });

  it("refuses anything that is not a record holding a draft", () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("a draft")).toBeNull();
    expect(parseStoredDraft({ v: 1 })).toBeNull();
  });

  it("fills in what a record is missing rather than losing the document with it", () => {
    const parsed = parseStoredDraft({ v: 1, draft: { content: "written" } });
    expect(parsed?.draft.content).toBe("written");
    expect(parsed?.draft.identifier).toBe("");
    expect(parsed?.draft.topics).toEqual([]);
    expect(parsed?.draft.kinds).toEqual([]);
    expect(parsed?.basedOn).toBeNull();
  });

  it("drops a topic or a kind that is not the shape one is", () => {
    const parsed = parseStoredDraft({
      v: 1,
      draft: { topics: ["nostr", 7, null], kinds: [{ raw: "1" }, "one", null] },
    });
    expect(parsed?.draft.topics).toEqual(["nostr"]);
    expect(parsed?.draft.kinds).toEqual([{ raw: "1", name: "" }]);
  });
});

describe("readDraft and writeDraft", () => {
  it("hands back what was written", () => {
    const record = stored();
    writeDraft(ME, { of: "doc", identifier: "a-document" }, record);
    expect(readDraft(ME, { of: "doc", identifier: "a-document" })).toEqual(record);
  });

  it("keeps the slot for a document apart from the one for a new document", () => {
    writeDraft(ME, { of: "new" }, stored({ title: "Unaddressed" }));
    writeDraft(ME, { of: "doc", identifier: "a-document" }, stored({ title: "Addressed" }));

    expect(readDraft(ME, { of: "new" })?.draft.title).toBe("Unaddressed");
    expect(readDraft(ME, { of: "doc", identifier: "a-document" })?.draft.title).toBe("Addressed");
  });

  it("keeps a fork apart from both, so starting one eats neither", () => {
    const origin = `30817:${OTHER}:a-document`;
    writeDraft(ME, { of: "new" }, stored({ title: "Unaddressed" }));
    writeDraft(ME, { of: "doc", identifier: "a-document" }, stored({ title: "Addressed" }));
    writeDraft(ME, { of: "fork", origin }, stored({ title: "Forked" }));

    expect(readDraft(ME, { of: "new" })?.draft.title).toBe("Unaddressed");
    expect(readDraft(ME, { of: "doc", identifier: "a-document" })?.draft.title).toBe("Addressed");
    expect(readDraft(ME, { of: "fork", origin })?.draft.title).toBe("Forked");
  });

  it("gives every origin a fork slot of its own", () => {
    writeDraft(ME, { of: "fork", origin: `30817:${OTHER}:one` }, stored({ title: "One" }));
    writeDraft(ME, { of: "fork", origin: `30817:${OTHER}:two` }, stored({ title: "Two" }));

    expect(readDraft(ME, { of: "fork", origin: `30817:${OTHER}:one` })?.draft.title).toBe("One");
    expect(readDraft(ME, { of: "fork", origin: `30817:${OTHER}:two` })?.draft.title).toBe("Two");
  });

  /** The collision the separate prefixes exist to prevent. */
  it("keeps a document identified as `new` apart from a new document", () => {
    writeDraft(ME, { of: "new" }, stored({ title: "Unaddressed" }));
    writeDraft(ME, { of: "doc", identifier: "new" }, stored({ title: "A document called new" }));

    expect(readDraft(ME, { of: "new" })?.draft.title).toBe("Unaddressed");
    expect(readDraft(ME, { of: "doc", identifier: "new" })?.draft.title).toBe(
      "A document called new",
    );
  });

  it("keeps one key's draft out of another's", () => {
    writeDraft(ME, { of: "doc", identifier: "a-document" }, stored({ title: "Mine" }));
    expect(readDraft(OTHER, { of: "doc", identifier: "a-document" })).toBeNull();
  });

  it("has nothing to offer where nothing was written", () => {
    expect(readDraft(ME, { of: "doc", identifier: "never-typed" })).toBeNull();
  });

  it("leaves a draft too large to store unsaved rather than throwing", () => {
    const huge = stored({ content: "x".repeat(MAX_DRAFT_BYTES + 1) });
    expect(() => writeDraft(ME, { of: "doc", identifier: "big" }, huge)).not.toThrow();
    expect(readDraft(ME, { of: "doc", identifier: "big" })).toBeNull();
  });

  it("carries on where the browser refuses to store anything", () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    expect(() => writeDraft(ME, { of: "doc", identifier: "a-document" }, stored())).not.toThrow();
    expect(readDraft(ME, { of: "doc", identifier: "a-document" })).toBeNull();
  });

  it("carries on where there is no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => writeDraft(ME, { of: "doc", identifier: "a-document" }, stored())).not.toThrow();
    expect(readDraft(ME, { of: "doc", identifier: "a-document" })).toBeNull();
    expect(() => clearDraft(ME, { of: "doc", identifier: "a-document" })).not.toThrow();
  });

  it("refuses to store a record it could not read back", () => {
    writeDraft(ME, { of: "doc", identifier: "a-document" }, {
      ...stored(),
      v: 2,
    } as unknown as StoredDraft);
    expect(readDraft(ME, { of: "doc", identifier: "a-document" })).toBeNull();
  });
});

describe("clearDraft", () => {
  it("removes only the slot it was asked for", () => {
    writeDraft(ME, { of: "new" }, stored({ title: "Unaddressed" }));
    writeDraft(ME, { of: "doc", identifier: "a-document" }, stored({ title: "Addressed" }));

    clearDraft(ME, { of: "doc", identifier: "a-document" });

    expect(readDraft(ME, { of: "doc", identifier: "a-document" })).toBeNull();
    expect(readDraft(ME, { of: "new" })?.draft.title).toBe("Unaddressed");
  });
});
