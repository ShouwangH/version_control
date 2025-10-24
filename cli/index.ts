#!/usr/bin/env bun
import { promises as fsp, Dirent } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createLocalRepo } from "../vc-core/repo";
import type { FileMap, VCRepo } from "../vc-core/types";

const IGNORED_DIRS = new Set([".git", ".vc", "node_modules", "dist", ".build", ".tmp"]);
const IGNORED_FILES = new Set([".DS_Store"]);

const program = new Command();
program.name("vc").description("vc-core local CLI");

program
  .command("init")
  .description("initialize a local vc-core repository under .vc/")
  .action(async () => {
    const repo = createRepo();
    await repo.init();
    console.log(`initialized repository at ${repoRoot()}`);
  });

program
  .command("status")
  .description("show current working commit information")
  .action(async () => {
    const repo = await ensureRepo();
    const working = await repo.getWorking();
    console.log(`parent: ${working.parentId ?? "none"}`);
    console.log(`tree:   ${working.treeHash}`);
  });

program
  .command("commit")
  .description("snapshot workspace files and create a new commit")
  .requiredOption("-m, --message <msg>", "commit message")
  .option("--source <source>", "commit source (human|ai|system)", "human")
  .action(async (opts: { message: string; source: string }) => {
    const repo = await ensureRepo();
    const before = await repo.getWorking();
    const files = await collectWorkspaceFiles(process.cwd());
    const after = await repo.snapshot(files);
    if (after.treeHash === before.treeHash) {
      console.log("no changes detected; nothing to commit");
      return;
    }
    const source = normalizeSource(opts.source);
    const commit = await repo.commit(opts.message, source, source === "ai" ? { origin: "cli" } : null);
    console.log(`commit ${commit.id}`);
  });

program
  .command("log")
  .description("display commit history")
  .action(async () => {
    const repo = await ensureRepo();
    const commits = await repo.log();
    commits.forEach((commit) => {
      const shortId = commit.id.slice(0, 8);
      const parents = commit.parents.map((p) => p.slice(0, 8)).join(" ");
      console.log(`${shortId} ${commit.source.padEnd(6)} ${new Date(commit.timestamp).toISOString()} ${parents} ${commit.message}`);
    });
  });

program
  .command("hydrate <ref>")
  .description("switch working state to the given commit or ref")
  .action(async (ref: string) => {
    const repo = await ensureRepo();
    try {
      const files = await repo.hydrate(ref);
      await writeWorkspace(process.cwd(), files);
      console.log(`hydrated ${ref}`);
    } catch (error) {
      handleError("hydrate", error);
    }
  });

program
  .command("merge <ref>")
  .description("merge the given ref into the working state")
  .action(async (ref: string) => {
    const repo = await ensureRepo();
    try {
      const result = await repo.merge(ref);
      if (result.conflicts.length > 0) {
        console.log(`merge produced ${result.conflicts.length} conflict(s)`);
        result.conflicts.forEach((conflict) => console.log(` - ${conflict.path}`));
        return;
      }

      if (result.mergedFiles) {
        await writeWorkspace(process.cwd(), result.mergedFiles);
      }

      if (result.commitId) {
        console.log(`merge commit ${result.commitId}`);
      } else {
        console.log("merge completed (no new commit)");
      }
    } catch (error) {
      handleError("merge", error);
    }
  });

await program.parseAsync();

function createRepo(): VCRepo {
  return createLocalRepo({ rootDir: process.cwd(), author: "cli" });
}

async function ensureRepo(): Promise<VCRepo> {
  const repo = createRepo();
  await repo.init();
  return repo;
}

function repoRoot() {
  return path.join(process.cwd(), ".vc");
}

function normalizeSource(input: string) {
  const lower = (input ?? "human").toLowerCase();
  if (lower === "ai" || lower === "system") return lower;
  return "human";
}

async function collectWorkspaceFiles(root: string): Promise<FileMap> {
  const files: FileMap = {};
  await traverseWorkspace(root, async (fullPath, relPath, entry) => {
    if (entry.isFile()) {
      files[relPath] = await fsp.readFile(fullPath, "utf8");
    }
  });
  return files;
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  await traverseWorkspace(root, async (_fullPath, relPath, entry) => {
    if (entry.isFile()) paths.push(relPath);
  });
  return paths;
}

async function writeWorkspace(root: string, files: FileMap) {
  const targetPaths = new Set(Object.keys(files));
  const existing = await listWorkspaceFiles(root);

  for (const relPath of existing) {
    if (!targetPaths.has(relPath)) {
      const absolute = path.join(root, relPath);
      await fsp.rm(absolute, { force: true });
      await cleanupEmptyDirs(root, path.dirname(absolute));
    }
  }

  for (const [relPath, content] of Object.entries(files)) {
    const absolute = path.join(root, relPath);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, content, "utf8");
  }
}

async function traverseWorkspace(
  current: string,
  visitor: (fullPath: string, relPath: string, entry: Dirent) => Promise<void>,
  root: string = current,
) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldIgnore(entry)) continue;
    const fullPath = path.join(current, entry.name);
    const relPath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      await traverseWorkspace(fullPath, visitor, root);
    } else if (entry.isFile()) {
      await visitor(fullPath, relPath, entry);
    }
  }
}

function shouldIgnore(entry: Dirent) {
  const name = entry.name;
  if (entry.isDirectory()) {
    return IGNORED_DIRS.has(name);
  }
  if (entry.isFile()) {
    return IGNORED_FILES.has(name);
  }
  return false;
}

async function cleanupEmptyDirs(root: string, dir: string) {
  let current = dir;
  while (current.startsWith(root) && current !== root) {
    try {
      await fsp.rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

function handleError(command: string, error: unknown) {
  if (error instanceof Error && /not implemented/i.test(error.message)) {
    console.error(`${command} is not implemented yet. ${error.message}`);
    return;
  }
  throw error instanceof Error ? error : new Error(String(error));
}
