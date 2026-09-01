import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { parseCoordinate, toCoordinate } from "../src/address";
import { SPEC_KIND, tagValue } from "../src/event";
import { latestByCoordinate } from "../src/relay";
import {
  buildSpec,
  buildSpecDeletion,
  editSpec,
  forkSpec,
  parseSpec,
  type Spec,
  type SpecDraft,
  specDraftOf,
  specFaults,
  toIdentifier,
  withdrawSpec,
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
      expect(named(editSpec(live, specDraftOf(live)), "client")).toEqual([
        ["client", "Open Specs"],
      ]);
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
      ["client", "Open Specs"],
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

describe("forkSpec", () => {
  const originKey = getPublicKey(generateSecretKey());
  const origin = { pubkey: originKey, identifier: "nip-01" };
  const copy = draftOf({ identifier: "nip-01", title: "NIP-01" });

  it("writes the marker, empty relay slot included", () => {
    expect(named(forkSpec(origin, author, copy), "a")).toEqual([
      ["a", `${SPEC_KIND}:${originKey}:nip-01`, "", "fork"],
    ]);
  });

  it("writes a relay hint when it is given one", () => {
    const draft = forkSpec({ ...origin, relay: " wss://relay.example  " }, author, copy);
    expect(named(draft, "a")).toEqual([
      ["a", `${SPEC_KIND}:${originKey}:nip-01`, "wss://relay.example", "fork"],
    ]);
  });

  it("says where it came from once it has been through the parser again", () => {
    expect(parseSpec(sign(forkSpec(origin, author, copy)))?.forks).toEqual([
      { type: "spec", coordinate: `${SPEC_KIND}:${originKey}:nip-01`, relay: null },
    ]);
  });

  it("carries nothing of the origin's own event", () => {
    const live = specEvent([
      ["d", "nip-01"],
      ["title", "NIP-01"],
      ["published_at", "1600000000"],
      ["icon", "https://example.com/i.png"],
    ]);
    const draft = forkSpec(origin, author, specDraftOf(live));
    expect(named(draft, "published_at")).toEqual([]);
    expect(named(draft, "icon")).toEqual([]);
  });

  it("does not point at the document it is building", () => {
    expect(named(forkSpec({ pubkey: author, identifier: "nip-01" }, author, copy), "a")).toEqual(
      [],
    );
  });

  it("points at the origin again once the fork moves to a name of its own", () => {
    const forked = forkSpec({ pubkey: author, identifier: "nip-01" }, author, copy);
    expect(named(forked, "a")).toEqual([]);
    const renamed = forkSpec(
      { pubkey: author, identifier: "nip-01" },
      author,
      draftOf({ identifier: "nip-01-mine", title: "NIP-01" }),
    );
    expect(named(renamed, "a")).toEqual([["a", `${SPEC_KIND}:${author}:nip-01`, "", "fork"]]);
  });

  it("keeps the marker through a later revision that renames the fork", () => {
    const live = sign(forkSpec(origin, author, copy));
    const renamed = editSpec(live, { ...specDraftOf(live), identifier: "nip-01-mine" });
    expect(named(renamed, "a")).toEqual([["a", `${SPEC_KIND}:${originKey}:nip-01`, "", "fork"]]);
    expect(named(renamed, "d")).toEqual([["d", "nip-01-mine"]]);
  });

  it("writes the marker where an edit would carry it, before the alt", () => {
    const names = forkSpec(origin, author, copy).tags.map((tag) => tag[0]);
    expect(names).toEqual(["d", "title", "a", "alt", "client"]);
  });
});

describe("withdrawSpec", () => {
  it("writes an address and nothing that was ever the document", () => {
    expect(withdrawSpec("x")).toEqual({
      kind: SPEC_KIND,
      content: "",
      tags: [
        ["d", "x"],
        ["client", "Open Specs"],
      ],
    });
  });

  it("carries none of a live revision, whatever that revision held", () => {
    for (const event of specs) {
      const identifier = parseSpec(event)?.identifier as string;
      const withdrawn = withdrawSpec(identifier);
      expect(withdrawn.tags.map((tag) => tag[0])).toEqual(["d", "client"]);
      expect(withdrawn.content).toBe("");
    }
  });

  it("parses as the same document, emptied, so it replaces rather than adds one", () => {
    const live = specEvent(
      [
        ["d", "here"],
        ["title", "Here"],
      ],
      "# Here\n\nSomething.",
    );
    const withdrawn = parseSpec(sign(withdrawSpec("here"), live.created_at + 1));
    expect(withdrawn?.identifier).toBe("here");
    expect(withdrawn?.pubkey).toBe(parseSpec(live)?.pubkey);
    expect(withdrawn?.isEmpty).toBe(true);
    expect(latestByCoordinate([parseSpec(live) as Spec, withdrawn as Spec])).toEqual([withdrawn]);
  });

  it("trims the identifier, as every other builder here does", () => {
    expect(named(withdrawSpec("  spaced  "), "d")).toEqual([["d", "spaced"]]);
  });
});

describe("buildSpecDeletion", () => {
  it("asks for a coordinate, and says which kind it names", () => {
    expect(buildSpecDeletion("30817:abc:x")).toEqual({
      kind: 5,
      content: "",
      tags: [
        ["a", "30817:abc:x"],
        ["k", "30817"],
        ["client", "Open Specs"],
      ],
    });
  });

  // A relay that only understands `e` would drop the revision named and leave
  // the one before it live, which republishes the document being withdrawn.
  it("names no event id", () => {
    expect(named(buildSpecDeletion("30817:abc:x"), "e")).toEqual([]);
  });

  it("round trips a coordinate holding colons of its own", () => {
    const pointer = { pubkey: "a".repeat(64), identifier: "stele:space:stele-test-docs" };
    const coordinate = tagValue(sign(buildSpecDeletion(toCoordinate(pointer))), "a");
    expect(parseCoordinate(coordinate)).toEqual({ ...pointer, relays: [] });
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
