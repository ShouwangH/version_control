import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { getDb } from "./db/schema";
import { sha256 } from "./utils/hash";
import { summarizeDiff } from "./utils/diff";
import { createLocalRepo } from "../vc-core/repo";
import type { RepoSnapshot, VCRepo } from "../vc-core/types";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
const db = getDb();

const REMOTE_BASE = process.env.VC_REMOTE_BASE ?? path.join(process.cwd(), ".vc-remote");
const DEFAULT_REPO_NAME = process.env.VC_REMOTE_NAME ?? "default";

type RepoEntry = { repo: VCRepo; ready: Promise<void> };
const repoCache = new Map<string, RepoEntry>();
let activeRepoName = DEFAULT_REPO_NAME;

function ensureBaseDir() {
  fs.mkdirSync(REMOTE_BASE, { recursive: true });
}

function sanitizeRepoName(input: string) {
  const value = input?.trim() ?? "";
  if (!value) {
    throw new Error("Repository name is required");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error("Repository name must contain only letters, numbers, dot, underscore, or hyphen");
  }
  return value;
}

function getRepoRoot(name: string) {
  return path.join(REMOTE_BASE, name);
}

function ensureRepoEntry(name: string): RepoEntry {
  ensureBaseDir();
  let entry = repoCache.get(name);
  if (!entry) {
    const repoRoot = getRepoRoot(name);
    fs.mkdirSync(repoRoot, { recursive: true });
    const repo = createLocalRepo({ rootDir: repoRoot, author: "server" });
    const ready = repo.init();
    entry = { repo, ready };
    repoCache.set(name, entry);
  }
  return entry;
}

async function getActiveRepo(): Promise<VCRepo> {
  const entry = ensureRepoEntry(activeRepoName);
  await entry.ready;
  return entry.repo;
}

async function switchActiveRepo(name: string): Promise<string> {
  const clean = sanitizeRepoName(name);
  activeRepoName = clean;
  const entry = ensureRepoEntry(clean);
  await entry.ready;
  return clean;
}

async function listAvailableRepos(): Promise<string[]> {
  ensureBaseDir();
  try {
    const entries = await fsp.readdir(REMOTE_BASE, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (!names.includes(activeRepoName)) {
      names.push(activeRepoName);
    }
    return Array.from(new Set(names)).sort();
  } catch (error) {
    console.error("list repos error", error);
    return [activeRepoName];
  }
}

ensureRepoEntry(activeRepoName);

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

function normalizeTextContent(value: string): string {
  if (value.includes("\\n") || value.includes("\\r") || value.includes("\\t")) {
    return value
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  return value;
}

type SnapshotIndexes = {
  treeIndex: Map<string, Record<string, string>>;
  blobIndex: Map<string, string>;
};

function buildSnapshotIndexes(snapshot: RepoSnapshot): SnapshotIndexes {
  const treeIndex = new Map(snapshot.trees.map((tree) => [tree.hash, { ...tree.files }]));
  const blobIndex = new Map(
    snapshot.blobs.map((blob) => [blob.hash, Buffer.from(blob.content, "base64").toString("utf8")]),
  );
  return { treeIndex, blobIndex };
}

function materializeTreeFromSnapshot(treeHash: string, indexes: SnapshotIndexes): Record<string, string> {
  const treeFiles = indexes.treeIndex.get(treeHash);
  if (!treeFiles) {
    throw new NotFoundError(`tree not found: ${treeHash}`);
  }
  const files: Record<string, string> = {};
  for (const [filePath, blobHash] of Object.entries(treeFiles)) {
    const content = indexes.blobIndex.get(blobHash);
    if (content === undefined) {
      throw new Error(`missing blob ${blobHash} for ${filePath}`);
    }
    files[filePath] = normalizeTextContent(content);
  }
  return files;
}

// health
app.get("/health", (_, res) => res.json({ ok: true }));

// POST /init  -> create default refs (HEAD -> refs/heads/main), seed empty commit
app.post("/init", (_req, res) => {
  const emptyTreeHash = "tree-" + sha256("{}");
  db.run(`INSERT OR IGNORE INTO trees(hash, files) VALUES(?, ?)`, emptyTreeHash, JSON.stringify({}));

  const firstCommitId = "c-" + sha256(emptyTreeHash + Date.now());
  const now = Date.now();
  db.run(
    `INSERT OR IGNORE INTO commits(id,parent_id,tree_hash,message,author,source,ai_meta,timestamp)
          VALUES(?,?,?,?,?,?,?,?)`,
    firstCommitId,
    null,
    emptyTreeHash,
    "init",
    "system",
    "human",
    null,
    now,
  );
  db.run(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`, "refs/heads/main", firstCommitId);
  db.run(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`, "HEAD", firstCommitId);
  res.json({ head: firstCommitId, tree: emptyTreeHash });
});

// GET /refs
app.get("/refs", async (_req, res) => {
  try {
    const repo = await getActiveRepo();
    const snapshot = await repo.exportSnapshot();
    res.json(snapshot.refs);
  } catch (error) {
    console.error("refs error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// POST /refs {name, commitId}
app.post("/refs", (req, res) => {
  const { name, commitId } = req.body;
  db.run(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`, name, commitId);
  res.json({ ok: true });
});

// POST /snapshot { files: Record<path, string> } -> store blobs and a tree
app.post("/snapshot", (req, res) => {
  const files: Record<string, string> = req.body?.files ?? {};
  const map: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const buf = Buffer.from(content, "utf8");
    const h = "b-" + sha256(buf);
    db.run(`INSERT OR IGNORE INTO blobs(hash, content, size) VALUES(?, ?, ?)`, h, buf, buf.length);
    map[path] = h;
  }
  const treeHash = "t-" + sha256(JSON.stringify(map));
  db.run(`INSERT OR IGNORE INTO trees(hash, files) VALUES(?, ?)`, treeHash, JSON.stringify(map));
  res.json({ treeHash });
});

// GET /tree/:hash -> { files: Record<path, string> with inline content }
app.get("/tree/:hash", async (req, res) => {
  try {
    const repo = await getActiveRepo();
    const snapshot = await repo.exportSnapshot();
    const indexes = buildSnapshotIndexes(snapshot);
    const files = materializeTreeFromSnapshot(req.params.hash, indexes);
    res.json({ files });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    console.error("tree error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// POST /commit {parentId, treeHash, message, author, source, aiMeta}
app.post("/commit", (req, res) => {
  const { parentId, treeHash, message, author = "you", source = "human", aiMeta } = req.body ?? {};
  const id = "c-" + sha256(
    [parentId, treeHash, message, author, source, JSON.stringify(aiMeta), Date.now()].join("|"),
  );
  db.run(
    `INSERT INTO commits(id,parent_id,tree_hash,message,author,source,ai_meta,timestamp)
          VALUES(?,?,?,?,?,?,?,?)`,
    id,
    parentId ?? null,
    treeHash,
    message,
    author,
    source,
    aiMeta ? JSON.stringify(aiMeta) : null,
    Date.now(),
  );
  db.run(`UPDATE refs SET commit_id = ? WHERE name IN ('HEAD','refs/heads/main')`, id);
  res.json({ id });
});

// GET /commits -> list with edges {id,parentId,...}
app.get("/commits", async (_req, res) => {
  try {
    const repo = await getActiveRepo();
    const commits = await repo.log();
    res.json(commits);
  } catch (error) {
    console.error("commits error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/graph", async (_req, res) => {
  try {
    const repo = await getActiveRepo();
    const snapshot = await repo.exportSnapshot();
    res.json({ commits: snapshot.commits, refs: snapshot.refs });
  } catch (error) {
    console.error("graph error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// POST /diff {olderTreeHash, newerTreeHash} -> { perFile: {path:{adds,dels}} }
app.post("/diff", async (req, res) => {
  const { olderTreeHash, newerTreeHash } = req.body as { olderTreeHash: string; newerTreeHash: string };
  try {
    const repo = await getActiveRepo();
    const snapshot = await repo.exportSnapshot();

    const indexes = buildSnapshotIndexes(snapshot);

    const oldFiles = materializeTreeFromSnapshot(olderTreeHash, indexes);
    const newFiles = materializeTreeFromSnapshot(newerTreeHash, indexes);

    const paths = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)]);
    const out: Record<string, { adds: number; dels: number; patch: string; before: string; after: string }> = {};

    for (const path of paths) {
      const before = oldFiles[path] ?? "";
      const after = newFiles[path] ?? "";
      const summary = summarizeDiff(path, before, after);
      out[path] = { ...summary, before, after };
    }

    res.json({ perFile: out });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    console.error("diff error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/repos", async (_req, res) => {
  try {
    const repos = await listAvailableRepos();
    res.json({ active: activeRepoName, repos });
  } catch (error) {
    console.error("repos error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/repos", async (req, res) => {
  const name = req.body?.name;
  if (typeof name !== "string") {
    return res.status(400).json({ error: "name must be a string" });
  }
  try {
    const clean = sanitizeRepoName(name);
    ensureRepoEntry(clean);
    const repos = await listAvailableRepos();
    res.json({ active: activeRepoName, repos });
  } catch (error) {
    console.error("create repo error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

app.post("/repos/use", async (req, res) => {
  const name = req.body?.name;
  if (typeof name !== "string") {
    return res.status(400).json({ error: "name must be a string" });
  }
  try {
    const active = await switchActiveRepo(name);
    const repos = await listAvailableRepos();
    res.json({ active, repos });
  } catch (error) {
    console.error("switch repo error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

app.post("/push", async (req, res) => {
  const snapshot = req.body as RepoSnapshot;
  try {
    const repo = await getActiveRepo();
    await repo.importSnapshot(snapshot);
    res.json({ ok: true });
  } catch (error) {
    console.error("push error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/pull", async (_req, res) => {
  try {
    const repo = await getActiveRepo();
    const snapshot = await repo.exportSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error("pull error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/working", async (_req, res) => {
  try {
    const repo = await getActiveRepo();
    const working = await repo.getWorking();
    const snapshot = await repo.exportSnapshot();
    const indexes = buildSnapshotIndexes(snapshot);
    const files = materializeTreeFromSnapshot(working.treeHash, indexes);
    res.json({ parentId: working.parentId, treeHash: working.treeHash, files });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    console.error("working error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`server on :${PORT}`));
