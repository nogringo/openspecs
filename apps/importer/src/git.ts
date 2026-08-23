import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const MAX_OUTPUT = 32 * 1024 * 1024;

const git = async (args: string[], cwd?: string): Promise<string> => {
  const { stdout } = await run("git", args, { cwd, maxBuffer: MAX_OUTPUT });
  return stdout;
};

/** A clone with no blobs until they are asked for: history is what this needs, not checkouts. */
export const ensureRepo = async (dir: string, url: string, branch: string): Promise<void> => {
  try {
    await git(["-C", dir, "rev-parse", "--git-dir"]);
    await git(["-C", dir, "fetch", "--quiet", "origin", branch]);
  } catch {
    await mkdir(dir, { recursive: true });
    await git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", url, dir]);
  }
};

export const headCommit = async (dir: string, branch: string): Promise<string> =>
  (await git(["-C", dir, "rev-parse", `origin/${branch}`])).trim();

export const fileAt = async (dir: string, commit: string, path: string): Promise<Buffer> => {
  const { stdout } = await run("git", ["-C", dir, "show", `${commit}:${path}`], {
    maxBuffer: MAX_OUTPUT,
    encoding: "buffer",
  });
  return stdout;
};

const commitDates = async (dir: string, commit: string, path: string): Promise<number[]> => {
  // `--follow` carries a document through the renames its number survived, and
  // takes exactly one path, which is why this asks per file rather than in bulk.
  const stdout = await git(["-C", dir, "log", "--follow", "--format=%ct", commit, "--", path]);
  return stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
};

/** When the file first appeared and when it last changed, newest first from `git log`. */
export const fileHistory = async (
  dir: string,
  commit: string,
  path: string,
): Promise<{ publishedAt: number; createdAt: number }> => {
  const dates = await commitDates(dir, commit, path);
  const newest = dates[0];
  const oldest = dates.at(-1);
  if (newest === undefined || oldest === undefined) {
    throw new Error(`${path} has no history at ${commit.slice(0, 7)}`);
  }
  return { publishedAt: oldest, createdAt: newest };
};
