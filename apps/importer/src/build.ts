import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { buildImport } from "./document.ts";
import { ensureRepo, fileAt, fileHistory, headCommit } from "./git.ts";
import { rewriteLinks, specIndex } from "./links.ts";
import type { Corpus } from "./manifest.ts";

export type BuildOptions = {
  corpora: Corpus[];
  cache: string;
  out: string;
};

/**
 * Every document as an event, from the manifests and the repositories and
 * nothing else. Signs nothing and reaches no relay: what this writes is read
 * before any of it is published.
 */
export const buildEvents = async ({ corpora, cache, out }: BuildOptions): Promise<void> => {
  const index = specIndex(corpora);
  await rm(out, { recursive: true, force: true });

  for (const corpus of corpora) {
    const dir = `${cache}/${corpus.name}`;
    await ensureRepo(dir, corpus.repo, corpus.branch);
    const commit = await headCommit(dir, corpus.branch);
    await mkdir(`${out}/${corpus.name}`, { recursive: true });

    let internal = 0;
    let external = 0;
    let anchors = 0;
    const absolutized: { target: string; url: string }[] = [];

    for (const entry of corpus.specs) {
      const bytes = await fileAt(dir, commit, entry.file);
      const { publishedAt, createdAt } = await fileHistory(dir, commit, entry.file);
      const { content, report } = rewriteLinks(bytes.toString("utf8"), {
        corpus,
        file: entry.file,
        commit,
        index,
      });

      const event = buildImport(corpus, entry, content, {
        commit,
        publishedAt,
        createdAt,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });

      await writeFile(
        `${out}/${corpus.name}/${entry.d}.json`,
        `${JSON.stringify(event, null, 2)}\n`,
      );

      internal += report.internal;
      external += report.external;
      anchors += report.anchors;
      absolutized.push(...report.absolutized);
    }

    console.log(
      `${corpus.name}\t${corpus.specs.length} documents at ${commit.slice(0, 7)}\t` +
        `${internal} internal, ${absolutized.length} pinned, ${external} external, ${anchors} anchors`,
    );
    for (const link of [...new Set(absolutized.map((link) => link.target))].sort()) {
      console.log(`\tpinned  ${link}`);
    }
  }

  console.log(`\nwritten to ${out}`);
};
