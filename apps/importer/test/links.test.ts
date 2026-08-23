import { parseSpecAddress } from "@openspecs/nostr";
import { describe, expect, it } from "vitest";
import { rewriteLinks, specIndex } from "../src/links.ts";
import type { Corpus } from "../src/manifest.ts";

const BUDS_KEY = "1336a17e161d0e8af2b68ee95ad2a479fc38bef96a17d6127ea02a40d28dd97e";
const NIPS_KEY = "2b39b4ffe62933df970e19366c22c1e092f953f83fcfed754e0f04d5a3b459f9";

const corpus = (over: Partial<Corpus>): Corpus => ({
  name: "buds",
  title: "Blossom Upgrade Documents",
  npub: "npub1",
  repo: "https://github.com/hzrd149/blossom",
  branch: "master",
  license: "Unlicense",
  topics: ["blossom"],
  pubkey: BUDS_KEY,
  specs: [
    { file: "buds/01.md", d: "bud-01", title: "One", status: null, summary: "s", kinds: [] },
    { file: "buds/02.md", d: "bud-02", title: "Two", status: null, summary: "s", kinds: [] },
  ],
  ...over,
});

const nips = corpus({
  name: "nips",
  repo: "https://github.com/nostr-protocol/nips",
  pubkey: NIPS_KEY,
  specs: [{ file: "94.md", d: "nip-94", title: "File", status: null, summary: "s", kinds: [] }],
});

const index = specIndex([corpus({}), nips]);
const context = { corpus: corpus({}), file: "buds/02.md", commit: "c0ffee", index };

const rewrite = (content: string) => rewriteLinks(content, context);

const addressOf = (content: string) => {
  const match = /nostr:(naddr1[a-z0-9]+)/.exec(content);
  return match?.[1] === undefined ? null : parseSpecAddress(match[1]);
};

describe("rewriteLinks", () => {
  it("turns a link to a document of the corpus into a nostr reference", () => {
    const { content, report } = rewrite("see [BUD-01](./01.md) for that");
    expect(report.internal).toBe(1);
    expect(addressOf(content)).toMatchObject({ pubkey: BUDS_KEY, identifier: "bud-01" });
  });

  it("keeps the fragment beside the reference", () => {
    const { content } = rewrite("[get](./01.md#get-sha256---get-blob)");
    expect(content).toMatch(/#get-sha256---get-blob\)$/);
    expect(addressOf(content)).toMatchObject({ identifier: "bud-01" });
  });

  it("reads a path from the root of the repository", () => {
    const { content } = rewrite("[one](/buds/01.md)");
    expect(addressOf(content)).toMatchObject({ identifier: "bud-01" });
  });

  it("crosses corpora, from a URL into another repository", () => {
    const { content, report } = rewrite(
      "[NIP-94](https://github.com/nostr-protocol/nips/blob/master/94.md)",
    );
    expect(report.internal).toBe(1);
    expect(addressOf(content)).toMatchObject({ pubkey: NIPS_KEY, identifier: "nip-94" });
  });

  it("pins a file of the repository that is not imported", () => {
    const { content, report } = rewrite("[the tests](../tests/02.md)");
    expect(content).toContain("https://github.com/hzrd149/blossom/blob/c0ffee/tests/02.md");
    expect(report.absolutized).toEqual([
      {
        target: "../tests/02.md",
        url: "https://github.com/hzrd149/blossom/blob/c0ffee/tests/02.md",
      },
    ]);
  });

  it("pins an image the same way, so nothing points at a path that no longer exists", () => {
    const { content } = rewrite("![a diagram](./flow.png)");
    expect(content).toBe(
      "![a diagram](https://github.com/hzrd149/blossom/blob/c0ffee/buds/flow.png)",
    );
  });

  it("leaves a link out of the three repositories alone", () => {
    const { content, report } = rewrite("[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)");
    expect(content).toContain("https://www.rfc-editor.org/rfc/rfc2119");
    expect(report.external).toBe(1);
  });

  it("leaves an anchor into the document itself alone", () => {
    const { content, report } = rewrite("[above](#blob-descriptor)");
    expect(content).toBe("[above](#blob-descriptor)");
    expect(report.anchors).toBe(1);
  });

  it("leaves a scheme it does not handle alone", () => {
    const { content } = rewrite("[write us](mailto:nobody@example.com) and [b](blossom:abc.pdf)");
    expect(content).toBe("[write us](mailto:nobody@example.com) and [b](blossom:abc.pdf)");
  });

  it("rewrites a reference definition, which is what carries the NUTs", () => {
    const { content, report } = rewrite("as in [one][01].\n\n[01]: ./01.md");
    expect(report.internal).toBe(1);
    expect(content).toMatch(/^\[01\]: nostr:naddr1[a-z0-9]+$/m);
  });

  it("leaves a fenced block untouched, example links included", () => {
    const source = ["before [one](./01.md)", "```md", "[one](./01.md)", "```"].join("\n");
    const { content, report } = rewrite(source);
    expect(report.internal).toBe(1);
    expect(content.split("\n").at(2)).toBe("[one](./01.md)");
  });

  it("returns a document it changed nothing in unchanged", () => {
    const source = "# Title\n\nNothing to see, `01.md` in code only.\n";
    expect(rewrite(source).content).toBe(source);
  });
});
