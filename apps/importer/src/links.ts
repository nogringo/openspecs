import { dirname, join, normalize } from "node:path/posix";
import { toNaddr } from "@openspecs/nostr";
import type { Corpus } from "./manifest.ts";

export type Destination = { pubkey: string; identifier: string };

export type SpecIndex = {
  repos: string[];
  find: (repo: string, path: string) => Destination | null;
};

export type LinkReport = {
  /** Rewritten to a `nostr:` reference, whether inside this corpus or another. */
  internal: number;
  /** Left as they were: they point outside the three repositories. */
  external: number;
  /** Into the document itself, which `rehype-slug` resolves on its own. */
  anchors: number;
  /**
   * Pinned to the source repository because the file they name is not imported.
   * Listed rather than counted: this is what a reviewer reads to find a link
   * that should have stayed inside the corpus.
   */
  absolutized: { target: string; url: string }[];
};

export type Rewrite = { content: string; report: LinkReport };

const GITHUB = "https://github.com/";
const RAW = "https://raw.githubusercontent.com/";

const trimRepo = (repo: string): string => repo.replace(/\.git$/, "").replace(/\/+$/, "");

/** Where a file lives in its repository, pinned so the bytes behind it cannot change. */
export const sourceUrl = (repo: string, commit: string, path: string): string =>
  `${trimRepo(repo)}/blob/${commit}/${path}`;

export const specIndex = (corpora: Corpus[]): SpecIndex => {
  const byRepo = new Map<string, Map<string, Destination>>();
  for (const corpus of corpora) {
    const files = new Map<string, Destination>();
    for (const spec of corpus.specs) {
      files.set(spec.file, { pubkey: corpus.pubkey, identifier: spec.d });
    }
    byRepo.set(trimRepo(corpus.repo), files);
  }

  return {
    repos: [...byRepo.keys()],
    find: (repo, path) => byRepo.get(trimRepo(repo))?.get(path) ?? null,
  };
};

/** The repository and path a GitHub URL names, or null when it names something else. */
const repoFile = (url: string, repos: string[]): { repo: string; path: string } | null => {
  const afterRef = (rest: string): string | null => {
    const slash = rest.indexOf("/");
    return slash > 0 ? rest.slice(slash + 1) : null;
  };

  for (const repo of repos) {
    for (const view of ["blob", "tree"]) {
      const prefix = `${repo}/${view}/`;
      if (url.startsWith(prefix)) {
        const path = afterRef(url.slice(prefix.length));
        if (path !== null) return { repo, path };
      }
    }

    const prefix = repo.startsWith(GITHUB) ? `${RAW}${repo.slice(GITHUB.length)}/` : null;
    if (prefix !== null && url.startsWith(prefix)) {
      const path = afterRef(url.slice(prefix.length));
      if (path !== null) return { repo, path };
    }
  }

  return null;
};

export type LinkContext = {
  corpus: Pick<Corpus, "repo">;
  /** Repo-relative path of the document being rewritten, which relative links resolve against. */
  file: string;
  /** What every link leaving the corpus is pinned to. */
  commit: string;
  index: SpecIndex;
};

/**
 * A `nostr:` reference keeps its fragment. NIP-21 says nothing about one, but
 * bech32's alphabet has no `#`, so a reader scanning for the identifier stops
 * where the fragment starts and what follows is either used or ignored.
 */
const reference = (destination: Destination, fragment: string): string =>
  `nostr:${toNaddr(destination)}${fragment}`;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const rewriteTarget = (target: string, context: LinkContext, report: LinkReport): string => {
  if (target === "" || target.startsWith("<")) return target;

  if (target.startsWith("#")) {
    report.anchors++;
    return target;
  }

  const cut = target.indexOf("#");
  const path = cut === -1 ? target : target.slice(0, cut);
  const fragment = cut === -1 ? "" : target.slice(cut);

  if (SCHEME.test(path)) {
    if (!/^https?:\/\//i.test(path)) return target;

    const named = repoFile(path, context.index.repos);
    const destination = named === null ? null : context.index.find(named.repo, named.path);
    if (destination === null) {
      report.external++;
      return target;
    }
    report.internal++;
    return reference(destination, fragment);
  }

  const repo = trimRepo(context.corpus.repo);
  const resolved = path.startsWith("/")
    ? path.slice(1)
    : normalize(join(dirname(context.file), path));
  if (resolved.startsWith("..")) return target;

  const destination = context.index.find(repo, resolved);
  if (destination !== null) {
    report.internal++;
    return reference(destination, fragment);
  }

  const url = sourceUrl(repo, context.commit, resolved) + fragment;
  report.absolutized.push({ target, url });
  return url;
};

const FENCE = /^[ ]{0,3}(`{3,}|~{3,})/;

/** Prose and fenced code, in order. Only the prose is rewritten. */
const segments = (content: string): { text: string; code: boolean }[] => {
  const parts: { text: string; code: boolean }[] = [];
  let lines: string[] = [];
  let fence: string | null = null;

  const flush = (code: boolean) => {
    if (lines.length > 0) parts.push({ text: lines.join("\n"), code });
    lines = [];
  };

  for (const line of content.split("\n")) {
    const opener = FENCE.exec(line)?.[1];
    if (fence === null && opener !== undefined) {
      flush(false);
      fence = opener[0] ?? null;
      lines.push(line);
      continue;
    }
    if (fence !== null && opener?.startsWith(fence)) {
      lines.push(line);
      flush(true);
      fence = null;
      continue;
    }
    lines.push(line);
  }
  flush(fence !== null);

  return parts;
};

/** The target of an inline link or image, anchored on `](` so a label may hold anything. */
const INLINE = /(\]\()([^()\s]*)((?:[ \t]+"[^"]*")?\))/g;
/** The target of a reference definition, which is what the NUTs use throughout. */
const REFERENCE = /^([ ]{0,3}\[[^\]]+\]:[ \t]*)(\S+)/gm;

export const rewriteLinks = (content: string, context: LinkContext): Rewrite => {
  const report: LinkReport = { internal: 0, external: 0, anchors: 0, absolutized: [] };

  const rewritten = segments(content)
    .map(({ text, code }) =>
      code
        ? text
        : text
            .replace(INLINE, (_, open, target, close) =>
              [open, rewriteTarget(target, context, report), close].join(""),
            )
            .replace(
              REFERENCE,
              (_, label, target) => label + rewriteTarget(target, context, report),
            ),
    )
    .join("\n");

  return { content: rewritten, report };
};
