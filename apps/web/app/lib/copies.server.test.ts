import { afterEach, describe, expect, it, vi } from "vitest";

const nostr = vi.hoisted(() => ({ fetchSpecs: vi.fn() }));

vi.mock("@openspecs/nostr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openspecs/nostr")>()),
  ...nostr,
}));

import { parseSpec, SPEC_KIND, type Spec } from "@openspecs/nostr";
import { loadCopies } from "./copies.server";
import { toPage } from "./spec-page";
import type { CachedSpec } from "./specs.server";

const SHOWN = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const OTHER = "2446a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const BODY = "One paragraph that stays.\n\nAnother that both keep.\n\nA third, as written here.";

const specOf = (pubkey: string, id: string, content: string): Spec => {
  const spec = parseSpec({
    id: id.padEnd(64, "0"),
    pubkey,
    created_at: 1,
    kind: SPEC_KIND,
    tags: [
      ["d", "nip-07"],
      ["title", "NIP-07"],
    ],
    content,
    sig: "b".repeat(128),
  });
  if (spec === null) throw new Error("the fixture does not parse as a document");
  return spec;
};

const cachedOf = (spec: Spec): CachedSpec => ({ page: toPage(spec), event: spec.event });

afterEach(() => {
  nostr.fetchSpecs.mockReset();
  vi.useRealTimers();
});

describe("loadCopies", () => {
  it("finds another key's copy and marks where it departs from the served revision", async () => {
    const shown = specOf(SHOWN, "a1", BODY);
    const other = specOf(OTHER, "b1", BODY.replace("as written here", "as rewritten there"));
    nostr.fetchSpecs.mockImplementation(async (query: { identifiers?: string[] }) =>
      query.identifiers ? [shown, other] : [],
    );

    const known = await loadCopies(cachedOf(shown));

    expect(known?.eventId).toBe(shown.event.id);
    expect(known?.copies.map((copy) => copy.pubkey)).toEqual([OTHER]);
    expect(known?.standings[`${OTHER}:nip-07`]).toEqual({ kind: "kin", places: 1 });
    expect(known?.spots.map((spot) => spot.element)).toEqual([2]);
  });

  it("gives up on slow relays, and has the answer for the next request", async () => {
    vi.useFakeTimers();
    const shown = specOf(SHOWN, "a2", BODY);
    const answers: ((specs: Spec[]) => void)[] = [];
    nostr.fetchSpecs.mockImplementation(
      () =>
        new Promise<Spec[]>((resolve) => {
          answers.push(resolve);
        }),
    );

    const first = loadCopies(cachedOf(shown));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toBeNull();

    for (const answer of answers) answer([shown, specOf(OTHER, "b2", BODY)]);
    await vi.advanceTimersByTimeAsync(0);
    const next = await loadCopies(cachedOf(shown));
    expect(next?.copies).toHaveLength(1);
  });
});
