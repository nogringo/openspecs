import { verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec";
import { caseEvents, events } from "./fixtures";

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
