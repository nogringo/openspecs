import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { SPEC_KIND } from "../src/event";
import {
  buildSpec,
  editSpec,
  parseSpec,
  type SpecDraft,
  specDraftOf,
  specFaults,
  toIdentifier,
} from "../src/spec";
import { caseEvents, events } from "./fixtures";

const secretKey = generateSecretKey();
const author = getPublicKey(secretKey);

/**
 * No fixture carries a `t`, `summary` or `published_at` tag, and none can be
 * added: `cases.json` only indexes events pulled verbatim from relays, and every
 * one of them is checked against its signature above. Those cases are signed here.
 */
const specEvent = (tags: string[][], content = "", createdAt = 1_700_000_000) =>
  finalizeEvent({ kind: SPEC_KIND, created_at: createdAt, tags, content }, secretKey);

const sign = (
  draft: { kind: number; content: string; tags: string[][] },
  createdAt = 1_700_000_100,
) => finalizeEvent({ ...draft, created_at: createdAt }, secretKey);

const named = (event: { tags: string[][] }, name: string): string[][] =>
  event.tags.filter((tag) => tag[0] === name);

const draftOf = (fields: Partial<SpecDraft> = {}): SpecDraft => ({
  identifier: "",
  title: "",
  summary: "",
  content: "",
  status: "",
  topics: [],
  kinds: [],
  ...fields,
});

/** Every fixture this project considers a specification, which is what an edit must survive. */
const specs = events.filter((event) => parseSpec(event) !== null);

describe("fixtures", () => {
  it("are verbatim events, signatures intact", () => {
    const forged = events.filter((event) => !verifyEvent(event));
    expect(forged.map((e) => e.id)).toEqual([]);
  });

  it("every listed case resolves to an event", () => {
    expect(() => caseEvents("canonical")).not.toThrow();
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("parseSpec", () => {
  it("rejects an application squatting the kind with an unrelated schema", () => {
    for (const event of caseEvents("kind-collision")) {
      expect(parseSpec(event)).toBeNull();
    }
  });

  it("rejects anything that is not a well formed event", () => {
    expect(parseSpec(null)).toBeNull();
    expect(parseSpec({})).toBeNull();
    expect(parseSpec({ ...events[0], id: "nope" })).toBeNull();
  });

  it("rejects another kind", () => {
    expect(parseSpec({ ...events[0], kind: 30023 })).toBeNull();
  });

  it("accepts every fixture that is a real specification", () => {
    const collisions = new Set(caseEvents("kind-collision").map((e) => e.id));
    for (const event of events) {
      if (collisions.has(event.id)) continue;
      expect(parseSpec(event), `fixture ${event.id} should parse`).not.toBeNull();
    }
  });

  it("reads the published title when there is one", () => {
    for (const event of caseEvents("canonical")) {
      const spec = parseSpec(event);
      expect(spec?.titleIsDerived).toBe(false);
      expect(spec?.title).not.toBe("");
    }
  });

  it("keeps a kind reference whose name was never published", () => {
    const refs = caseEvents("k-without-name").flatMap((e) => parseSpec(e)?.kinds ?? []);
    const unnamed = refs.filter((ref) => ref.name === null);
    expect(unnamed.length).toBeGreaterThan(0);
    for (const ref of unnamed) expect(ref.raw).not.toBe("");
  });

  it("keeps a kind reference that is not a number instead of producing NaN", () => {
    const refs = caseEvents("k-not-numeric").flatMap((e) => parseSpec(e)?.kinds ?? []);
    const nonNumeric = refs.filter((ref) => ref.kind === null);
    expect(nonNumeric.length).toBeGreaterThan(0);
    for (const ref of nonNumeric) {
      expect(ref.raw).not.toBe("");
      expect(Number.isNaN(ref.kind as unknown as number)).toBe(false);
    }
  });

  it("leaves a specification unrelated to any event kind without kind references", () => {
    for (const event of caseEvents("no-kind-tags")) {
      expect(parseSpec(event)?.kinds).toEqual([]);
    }
  });

  it("parses a blank document but flags it as empty", () => {
    for (const event of caseEvents("empty-content")) {
      const spec = parseSpec(event);
      expect(spec).not.toBeNull();
      expect(spec?.isEmpty).toBe(true);
    }
  });

  it("preserves an identifier that is not a clean slug", () => {
    for (const event of caseEvents("d-not-kebab")) {
      const published = event.tags.find((t) => t[0] === "d")?.[1];
      expect(parseSpec(event)?.identifier).toBe(published);
    }
  });

  it("falls back to a title when none was published", () => {
    for (const event of caseEvents("empty-content")) {
      const spec = parseSpec(event);
      if (spec?.titleIsDerived) expect(spec.title).not.toBe("");
    }
  });

  it("bounds the derived summary so it fits a meta description", () => {
    for (const event of events) {
      const spec = parseSpec(event);
      if (spec) expect(spec.summary.length).toBeLessThanOrEqual(165);
    }
  });

  it("says whether the summary was written or taken from the document", () => {
    for (const event of events) {
      const spec = parseSpec(event);
      if (!spec) continue;
      const summaryTag = (event.tags.find((tag) => tag[0] === "summary")?.[1] ?? "").trim();
      expect(spec.summaryIsDerived, `fixture ${event.id}`).toBe(summaryTag === "");
      if (!spec.summaryIsDerived) expect(spec.summary).toBe(summaryTag);
    }
  });

  it("never leaks heading underlines into the summary", () => {
    for (const event of events) {
      const spec = parseSpec(event);
      if (spec) expect(spec.summary, `fixture ${event.id}`).not.toMatch(/[=]{3,}|[-]{3,}/);
    }
  });

  it("never reduces the summary to a status line", () => {
    const statusOnly = /^(draft|final|optional|mandatory|deprecated|\s)+$/i;
    for (const event of events) {
      const spec = parseSpec(event);
      if (spec?.summary) expect(spec.summary, `fixture ${event.id}`).not.toMatch(statusOnly);
    }
  });

  it("sees two revisions of one document as the same coordinate", () => {
    const specs = caseEvents("same-coordinate-two-revisions").map((e) => parseSpec(e));
    const coordinates = new Set(specs.map((s) => `${s?.pubkey}:${s?.identifier}`));
    expect(coordinates.size).toBeLessThan(specs.length);
  });

  it("falls back to created_at when published_at is absent or unusable", () => {
    for (const event of events) {
      const spec = parseSpec(event);
      if (spec) expect(spec.publishedAt).toBeGreaterThan(0);
    }
  });
});

describe("specDraftOf", () => {
  it("hands back a title as published", () => {
    for (const event of caseEvents("canonical")) {
      expect(specDraftOf(event).title).toBe(parseSpec(event)?.title);
    }
  });

  it("hands back nothing where the title was only inferred", () => {
    const derived = specs.filter((event) => parseSpec(event)?.titleIsDerived);
    expect(derived.length).toBeGreaterThan(0);
    for (const event of derived) {
      expect(specDraftOf(event).title, `fixture ${event.id}`).toBe("");
    }
  });

  it("hands back nothing where the summary was taken from the document", () => {
    const derived = specs.filter((event) => parseSpec(event)?.summaryIsDerived);
    expect(derived.length).toBeGreaterThan(0);
    for (const event of derived) {
      expect(specDraftOf(event).summary, `fixture ${event.id}`).toBe("");
    }
  });

  it("keeps the case of a topic that a listing folds down", () => {
    const event = specEvent([
      ["d", "casing"],
      ["t", "Nostr"],
    ]);
    expect(parseSpec(event)?.topics).toEqual(["nostr"]);
    expect(specDraftOf(event).topics).toEqual(["Nostr"]);
  });

  it("keeps an identifier that is not a clean slug", () => {
    for (const event of caseEvents("d-not-kebab")) {
      expect(specDraftOf(event).identifier).toBe(event.tags.find((t) => t[0] === "d")?.[1]);
    }
  });

  it("keeps the document verbatim, trailing whitespace and all", () => {
    const event = specEvent([["d", "prose"]], "One paragraph.\n\n");
    expect(specDraftOf(event).content).toBe("One paragraph.\n\n");
  });

  it("reads a status published under either name", () => {
    expect(
      specDraftOf(
        specEvent([
          ["d", "a"],
          ["s", "draft"],
        ]),
      ).status,
    ).toBe("draft");
    expect(
      specDraftOf(
        specEvent([
          ["d", "b"],
          ["status", "final"],
        ]),
      ).status,
    ).toBe("final");
  });

  it("is empty for anything that is not a document", () => {
    const empty = draftOf();
    expect(specDraftOf(null)).toEqual(empty);
    expect(specDraftOf(specEvent([["d", "kinded"]]))).not.toEqual(empty);
    expect(specDraftOf({ ...specEvent([["d", "kinded"]]), kind: 0 })).toEqual(empty);
    expect(specDraftOf(specEvent([["title", "No address"]]))).toEqual(empty);
    for (const event of caseEvents("kind-collision")) expect(specDraftOf(event)).toEqual(empty);
  });
});

describe("editSpec", () => {
  it("hands every fixture back tag for tag", () => {
    for (const live of specs) {
      const rebuilt = editSpec(live, specDraftOf(live));
      // A tag published with nothing in it is the one thing an edit drops, and
      // deliberately: a blank field is a cleared field.
      const kept = live.tags.filter(
        (tag) => tag[0] !== "client" && tag[0] !== "alt" && (tag[1] ?? "").trim() !== "",
      );
      for (const tag of kept) {
        expect(rebuilt.tags, `fixture ${live.id} lost ${JSON.stringify(tag)}`).toContainEqual(tag);
      }
      expect(rebuilt.content).toBe(live.content);
    }
  });

  it("says the same thing once it has been through the parser again", () => {
    for (const live of specs) {
      const before = parseSpec(live);
      const after = parseSpec(sign(editSpec(live, specDraftOf(live))));
      expect(after, `fixture ${live.id}`).not.toBeNull();
      for (const field of [
        "identifier",
        "title",
        "titleIsDerived",
        "summary",
        "summaryIsDerived",
        "content",
        "status",
      ] as const) {
        expect(after?.[field], `fixture ${live.id}, ${field}`).toEqual(before?.[field]);
      }
      expect(after?.kinds).toEqual(before?.kinds);
      expect(after?.topics).toEqual(before?.topics);
      expect(after?.forks).toEqual(before?.forks);
    }
  });

  it("never promotes a title or a summary the parser only inferred", () => {
    for (const live of specs) {
      const spec = parseSpec(live);
      const rebuilt = editSpec(live, specDraftOf(live));
      if (spec?.titleIsDerived) expect(named(rebuilt, "title"), `fixture ${live.id}`).toEqual([]);
      if (spec?.summaryIsDerived) expect(named(rebuilt, "summary")).toEqual([]);
    }
  });

  it("keeps the tags another client wrote, in the order it wrote them", () => {
    const live = specEvent([
      ["d", "space"],
      ["title", "A space"],
      ["description", "what it holds"],
      ["icon", "https://example.com/i.png"],
      ["page", "one"],
      ["page", "two"],
    ]);
    const foreign = editSpec(live, specDraftOf(live)).tags.filter((tag) =>
      ["description", "icon", "page"].includes(tag[0] ?? ""),
    );
    expect(foreign).toEqual([
      ["description", "what it holds"],
      ["icon", "https://example.com/i.png"],
      ["page", "one"],
      ["page", "two"],
    ]);
  });

  it("keeps a fork marker, empty relay slot included", () => {
    const live = specEvent([
      ["d", "forked"],
      ["title", "Forked"],
      ["a", `${SPEC_KIND}:${author}:origin`, "", "fork"],
      ["i", "https://example.com/other", "fork"],
    ]);
    const rebuilt = editSpec(live, specDraftOf(live));
    expect(rebuilt.tags).toContainEqual(["a", `${SPEC_KIND}:${author}:origin`, "", "fork"]);
    expect(parseSpec(sign(rebuilt))?.forks).toEqual(parseSpec(live)?.forks);
  });

  it("names this client and only this client", () => {
    for (const live of specs) {
      expect(named(editSpec(live, specDraftOf(live)), "client")).toEqual([["client", "openspecs"]]);
    }
  });

  it("replaces a status published under the other name instead of leaving both", () => {
    const live = specEvent([
      ["d", "moving"],
      ["title", "Moving"],
      ["status", "draft"],
    ]);
    const rebuilt = editSpec(live, { ...specDraftOf(live), status: "final" });
    expect(named(rebuilt, "status")).toEqual([]);
    expect(named(rebuilt, "s")).toEqual([["s", "final"]]);
  });

  it("removes a field left blank rather than writing it empty", () => {
    const live = specEvent([
      ["d", "fading"],
      ["title", "Fading"],
      ["summary", "a description"],
      ["s", "draft"],
      ["t", "nostr"],
    ]);
    const rebuilt = editSpec(live, { ...specDraftOf(live), summary: "", status: "", topics: [] });
    expect(named(rebuilt, "summary")).toEqual([]);
    expect(named(rebuilt, "s")).toEqual([]);
    expect(named(rebuilt, "t")).toEqual([]);
  });
});

describe("editSpec and published_at", () => {
  it("leaves it off a document published for the first time", () => {
    const draft = buildSpec(draftOf({ identifier: "first", title: "First" }));
    expect(named(draft, "published_at")).toEqual([]);
    const spec = parseSpec(sign(draft));
    expect(spec?.publishedAt).toBe(spec?.createdAt);
  });

  it("backfills it from the first signature, so an edit is not a new publication", () => {
    const live = specEvent(
      [
        ["d", "aging"],
        ["title", "Aging"],
      ],
      "",
      1_600_000_000,
    );
    const rebuilt = editSpec(live, specDraftOf(live));
    expect(named(rebuilt, "published_at")).toEqual([["published_at", "1600000000"]]);
    const spec = parseSpec(sign(rebuilt, 1_700_000_000));
    expect(spec?.publishedAt).toBe(1_600_000_000);
    expect(spec?.createdAt).toBe(1_700_000_000);
  });

  it("keeps a published_at somebody already wrote", () => {
    const live = specEvent(
      [
        ["d", "dated"],
        ["title", "Dated"],
        ["published_at", "1500000000"],
      ],
      "",
      1_600_000_000,
    );
    expect(named(editSpec(live, specDraftOf(live)), "published_at")).toEqual([
      ["published_at", "1500000000"],
    ]);
  });
});

describe("buildSpec", () => {
  it("writes nothing it was not given", () => {
    expect(buildSpec(draftOf({ identifier: "x", title: "X" })).tags).toEqual([
      ["d", "x"],
      ["title", "X"],
      ["alt", "A specification: X"],
      ["client", "openspecs"],
    ]);
  });

  it("trims the identifier, or the coordinate a page computes can never be fetched", () => {
    const draft = buildSpec(draftOf({ identifier: "  spaced  ", title: "Spaced" }));
    expect(named(draft, "d")).toEqual([["d", "spaced"]]);
    expect(parseSpec(sign(draft))?.identifier).toBe("spaced");
  });

  it("writes a kind reference with its name only when it has one", () => {
    const draft = buildSpec(
      draftOf({
        identifier: "kinds",
        title: "Kinds",
        kinds: [
          { raw: "1", name: "" },
          { raw: "30817", name: "Custom NIP" },
          { raw: "", name: "orphan" },
        ],
      }),
    );
    expect(named(draft, "k")).toEqual([
      ["k", "1"],
      ["k", "30817", "Custom NIP"],
    ]);
  });

  it("keeps a kind value that is not a number", () => {
    const raw = caseEvents("k-not-numeric")
      .flatMap((e) => parseSpec(e)?.kinds ?? [])
      .find((ref) => ref.kind === null)?.raw as string;
    const draft = buildSpec(
      draftOf({ identifier: "odd", title: "Odd", kinds: [{ raw, name: "" }] }),
    );
    expect(parseSpec(sign(draft))?.kinds).toEqual([{ raw, kind: null, name: null }]);
  });

  it("drops a blank or repeated topic and keeps the order of the rest", () => {
    const draft = buildSpec(
      draftOf({ identifier: "t", title: "T", topics: ["relays", "  ", "nostr", "relays"] }),
    );
    expect(named(draft, "t")).toEqual([
      ["t", "relays"],
      ["t", "nostr"],
    ]);
  });

  it("describes itself for a client that does not know this kind", () => {
    expect(named(buildSpec(draftOf({ identifier: "untitled" })), "alt")).toEqual([
      ["alt", "A specification: untitled"],
    ]);
  });
});

describe("toIdentifier", () => {
  it("produces the identifiers these documents were actually filed under", () => {
    expect(toIdentifier("Gleason's NIP-01")).toBe("gleasons-nip-01");
    expect(toIdentifier("Duck's NIP-01")).toBe("ducks-nip-01");
    expect(toIdentifier("NIPs on Nostr")).toBe("nips-on-nostr");
    expect(toIdentifier("Slides - Presentations")).toBe("slides-presentations");
    expect(toIdentifier("Documentation Spaces")).toBe("documentation-spaces");
  });

  it("carries an accented title into an address", () => {
    expect(toIdentifier("Réseau maillé")).toBe("reseau-maille");
  });

  it("has nothing to suggest for a title that is not written yet", () => {
    expect(toIdentifier("")).toBe("");
    expect(toIdentifier("   ")).toBe("");
    expect(toIdentifier("!?-")).toBe("");
  });

  it("cuts a long title on a word, never mid-word or on a hyphen", () => {
    const long = toIdentifier(
      "A specification about relays and the documents that live on them forever",
    );
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).not.toMatch(/^-|-$/);
    expect(long).toBe("a-specification-about-relays-and-the-documents-that-live-on");
  });

  it("leaves an identifier it already produced alone", () => {
    for (const title of ["Gleason's NIP-01", "Réseau maillé", "Slides - Presentations"]) {
      expect(toIdentifier(toIdentifier(title))).toBe(toIdentifier(title));
    }
  });
});

describe("specFaults", () => {
  it("accepts a document nobody has written yet", () => {
    expect(specFaults(draftOf({ identifier: "blank", title: "Blank" }))).toEqual([]);
  });

  it("refuses an addressable document with no address", () => {
    expect(specFaults(draftOf({ title: "T" }))).toContain("no-identifier");
    expect(specFaults(draftOf({ identifier: "   ", title: "T" }))).toContain("no-identifier");
  });

  it("refuses an identifier a URL cannot carry in one segment", () => {
    expect(specFaults(draftOf({ identifier: "a/b", title: "T" }))).toContain(
      "identifier-has-slash",
    );
    expect(specFaults(draftOf({ identifier: "x".repeat(257), title: "T" }))).toContain(
      "identifier-too-long",
    );
  });

  it("asks for the title the schema calls required", () => {
    expect(specFaults(draftOf({ identifier: "x" }))).toContain("no-title");
  });

  it("accepts an identifier that is not a slug, since the wild is full of them", () => {
    for (const identifier of ["stele:space:stele-test-docs", "NIP-SP", "PQ2OY2CYh9jeSg5W"]) {
      expect(specFaults(draftOf({ identifier, title: "T" }))).toEqual([]);
    }
  });
});
