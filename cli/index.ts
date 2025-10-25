#!/usr/bin/env tsx
import { promises as fsp, Dirent } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createLocalRepo } from "vc-core/repo";
import type { FileMap, RepoSnapshot, VCRepo } from "vc-core/types";

const IGNORED_DIRS = new Set([".git", ".vc", "node_modules", "dist", ".build", ".tmp"]);
const IGNORED_FILES = new Set([".DS_Store"]);
const DEFAULT_REMOTE = process.env.VC_REMOTE ?? "http://localhost:3000";

type RemoteConfig = { baseUrl: string; repo: string };
interface CLIConfig {
  remote?: RemoteConfig;
}

const CONFIG_FILE = "config.json";

async function loadConfig(): Promise<CLIConfig> {
  try {
    const raw = await fsp.readFile(path.join(repoRoot(), CONFIG_FILE), "utf8");
    return JSON.parse(raw) as CLIConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveConfig(config: CLIConfig) {
  await fsp.mkdir(repoRoot(), { recursive: true });
  await fsp.writeFile(path.join(repoRoot(), CONFIG_FILE), JSON.stringify(config, null, 2));
}

async function saveRemoteConfig(remote: RemoteConfig) {
  const config = await loadConfig();
  config.remote = remote;
  await saveConfig(config);
}

async function resolveBaseUrl(remoteOption?: string) {
  if (remoteOption) return remoteOption;
  const config = await loadConfig();
  if (config.remote?.baseUrl) return config.remote.baseUrl;
  return DEFAULT_REMOTE;
}

async function resolveRemoteTarget(remoteOption?: string, repoOption?: string) {
  const config = await loadConfig();
  const baseUrl = await resolveBaseUrl(remoteOption);
  const repoName = repoOption ?? config.remote?.repo;
  if (!repoName) {
    throw new Error(
      "remote repository not specified. Run `vc remote add <name>` or use `--repo <name>` with push/pull.",
    );
  }
  return { baseUrl, repoName };
}

async function ensureRemoteSelected(baseUrl: string, repoName: string) {
  const res = await fetch(buildRemoteUrl(baseUrl, "/repos/use"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: repoName }),
  });
  if (res.status === 404) {
    throw new Error(`remote "${repoName}" does not exist at ${baseUrl}`);
  }
  if (!res.ok) {
    throw new Error(`failed to select remote ${repoName}: ${res.status} ${res.statusText}`);
  }
}

const program = new Command();
program.name("vc").description("vc-core local CLI");

const remoteCommand = program.command("remote").description("manage remote repositories");

remoteCommand
  .command("list")
  .option("--remote <url>", "remote base URL")
  .action(async (opts: { remote?: string }) => {
    const baseUrl = await resolveBaseUrl(opts.remote);
    try {
      const res = await fetch(buildRemoteUrl(baseUrl, "/repos"));
      if (!res.ok) {
        throw new Error(`list failed: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as { active: string | null; repos: string[] };
      console.log(`remote base: ${baseUrl}`);
      if (data.repos.length === 0) {
        console.log("no repositories found");
        return;
      }
      data.repos.forEach((name) => {
        const marker = name === data.active ? "*" : " ";
        console.log(`${marker} ${name}`);
      });
    } catch (error) {
      console.error(`[error] unable to list repositories: ${error instanceof Error ? error.message : error}`);
    }
  });

remoteCommand
  .command("add <name>")
  .option("--remote <url>", "remote base URL")
  .action(async (name: string, opts: { remote?: string }) => {
    const baseUrl = await resolveBaseUrl(opts.remote);
    const repoName = name.trim();
    if (!repoName) {
      console.error("repository name is required");
      return;
    }

    try {
      await ensureRemoteSelected(baseUrl, repoName);
    } catch (error) {
      console.error(
        `[error] unable to link remote: ${error instanceof Error ? error.message : error}. Create the repository in the web viewer (or run 'vc remote create ${repoName}') before linking.`,
      );
      return;
    }

    await saveRemoteConfig({ baseUrl, repo: repoName });
    console.log(`linked local repository to ${baseUrl}/${repoName}`);
  });

remoteCommand
  .command("use <name>")
  .option("--remote <url>", "remote base URL")
  .action(async (name: string, opts: { remote?: string }) => {
    const baseUrl = await resolveBaseUrl(opts.remote);
    try {
      await ensureRemoteSelected(baseUrl, name);
    } catch (error) {
      console.error(
        `[error] ${error instanceof Error ? error.message : error}. Create the repository in the web viewer before linking your local repo.`,
      );
      return;
    }
    await saveRemoteConfig({ baseUrl, repo: name });
    console.log(`using remote ${baseUrl}/${name}`);
  });

remoteCommand
  .command("create <name>")
  .option("--remote <url>", "remote base URL")
  .option("--use", "link this repository after creation")
  .action(async (name: string, opts: { remote?: string; use?: boolean }) => {
    const baseUrl = await resolveBaseUrl(opts.remote);
    const repoName = name.trim();
    if (!repoName) {
      console.error("repository name is required");
      return;
    }
    try {
      const res = await fetch(buildRemoteUrl(baseUrl, "/repos"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: repoName }),
      });
      if (res.status === 409) {
        console.error(`remote "${repoName}" already exists at ${baseUrl}`);
        return;
      }
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      console.log(`created remote ${baseUrl}/${repoName}`);
      if (opts.use) {
        await ensureRemoteSelected(baseUrl, repoName);
        await saveRemoteConfig({ baseUrl, repo: repoName });
        console.log(`linked local repository to ${baseUrl}/${repoName}`);
      } else {
        console.log(`run 'vc remote add ${repoName} --remote ${baseUrl}' to link your local repository.`);
      }
    } catch (error) {
      console.error(
        `[error] failed to create remote: ${error instanceof Error ? error.message : error}.`,
      );
    }
  });

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
    let hasChanges = after.treeHash !== before.treeHash;
    if (!hasChanges && before.parentId) {
      const commits = await repo.log();
      const parentCommit = commits.find((commit) => commit.id === before.parentId);
      if (parentCommit && parentCommit.treeHash !== after.treeHash) {
        hasChanges = true;
      }
    }
    if (!hasChanges) {
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
      const before = await repo.getWorking();
      const files = await repo.hydrate(ref);
      const after = await repo.getWorking();
      if (after.treeHash === before.treeHash) {
        console.log(`hydrated ${ref} (no changes)`);
        return;
      }
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
      if (result.mergedFiles) {
        await writeWorkspace(process.cwd(), result.mergedFiles);
      }

      if (result.conflicts.length > 0) {
        console.log(`merge produced ${result.conflicts.length} conflict(s)`);
        result.conflicts.forEach((conflict) => console.log(` - ${conflict.path}`));
        console.log("conflict markers written to workspace files");
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

program
  .command("push")
  .description("push local repository state to remote")
  .option("--remote <url>", "remote base URL")
  .option("--repo <name>", "remote repository name")
  .action(async (opts: { remote?: string; repo?: string }) => {
    const repo = await ensureRepo();
    const { baseUrl, repoName } = await resolveRemoteTarget(opts.remote, opts.repo);
    try {
      await ensureRemoteSelected(baseUrl, repoName);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}. Create the repository in the web viewer before pushing.`,
      );
    }
    const snapshot = await repo.exportSnapshot();
    await sendSnapshot(baseUrl, snapshot);
    console.log(`pushed ${snapshot.commits.length} commits to ${baseUrl}/${repoName}`);
  });

program
  .command("pull")
  .description("pull remote repository state into local repo")
  .option("--remote <url>", "remote base URL")
  .option("--repo <name>", "remote repository name")
  .action(async (opts: { remote?: string; repo?: string }) => {
    const repo = await ensureRepo();
    const { baseUrl, repoName } = await resolveRemoteTarget(opts.remote, opts.repo);
    try {
      await ensureRemoteSelected(baseUrl, repoName);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}. Create the repository in the web viewer before pulling.`,
      );
    }
    const snapshot = await fetchSnapshot(baseUrl);
    await repo.importSnapshot(snapshot);
    console.log(`pulled ${snapshot.commits.length} commits from ${baseUrl}/${repoName}`);
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

async function sendSnapshot(remote: string, snapshot: RepoSnapshot) {
  const url = buildRemoteUrl(remote, "/push");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) {
    throw new Error(`push failed: ${res.status} ${res.statusText}`);
  }
}

async function fetchSnapshot(remote: string): Promise<RepoSnapshot> {
  const url = buildRemoteUrl(remote, "/pull");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`pull failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as RepoSnapshot;
}

function buildRemoteUrl(base: string, pathSuffix: string) {
  const baseUrl = base.endsWith("/") ? base : `${base}/`;
  const target = pathSuffix.startsWith("/") ? pathSuffix.slice(1) : pathSuffix;
  return new URL(target, baseUrl).toString();
}
