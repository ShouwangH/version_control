import express from "express";
import cors from "cors";
import path from "node:path";
import { getDb } from "./db/schema";
import { sha256 } from "./utils/hash";
import { summarizeDiff } from "./utils/diff";
import { createLocalRepo } from "../vc-core/repo";
import type { RepoSnapshot } from "../vc-core/types";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
const db = getDb();

const remoteRepo = createLocalRepo({ rootDir: path.join(process.cwd(), ".vc-remote"), author: "server" });
const repoReady = remoteRepo.init();

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
    await repoReady;
    const snapshot = await remoteRepo.exportSnapshot();
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
    await repoReady;
    const snapshot = await remoteRepo.exportSnapshot();
    const tree = snapshot.trees.find((entry) => entry.hash === req.params.hash);
    if (!tree) {
      return res.status(404).json({ error: "tree not found" });
    }

    const blobIndex = new Map(
      snapshot.blobs.map((blob) => [blob.hash, Buffer.from(blob.content, "base64").toString("utf8")]),
    );

    const files: Record<string, string> = {};
    for (const [path, blobHash] of Object.entries(tree.files)) {
      const content = blobIndex.get(blobHash);
      if (content === undefined) {
        return res.status(500).json({ error: `missing blob ${blobHash} for ${path}` });
      }
      files[path] = content;
    }

    res.json({ files });
  } catch (error) {
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
    await repoReady;
    const commits = await remoteRepo.log();
    res.json(commits);
  } catch (error) {
    console.error("commits error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/graph", async (_req, res) => {
  try {
    await repoReady;
    const snapshot = await remoteRepo.exportSnapshot();
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
    await repoReady;
    const snapshot = await remoteRepo.exportSnapshot();

    const treeIndex = new Map(snapshot.trees.map((tree) => [tree.hash, tree.files]));
    const blobIndex = new Map(
      snapshot.blobs.map((blob) => [blob.hash, Buffer.from(blob.content, "base64").toString("utf8")]),
    );

    const materializeFiles = (treeHash: string) => {
      const treeFiles = treeIndex.get(treeHash);
      if (!treeFiles) throw new Error(`tree not found: ${treeHash}`);
      const files: Record<string, string> = {};
      for (const [filePath, blobHash] of Object.entries(treeFiles)) {
        const content = blobIndex.get(blobHash);
        if (content === undefined) {
          throw new Error(`missing blob ${blobHash} for ${filePath}`);
        }
        files[filePath] = content;
      }
      return files;
    };

    const oldFiles = materializeFiles(olderTreeHash);
    const newFiles = materializeFiles(newerTreeHash);

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
    console.error("diff error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/push", async (req, res) => {
  const snapshot = req.body as RepoSnapshot;
  try {
    await repoReady;
    await remoteRepo.importSnapshot(snapshot);
    res.json({ ok: true });
  } catch (error) {
    console.error("push error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/pull", async (_req, res) => {
  try {
    await repoReady;
    const snapshot = await remoteRepo.exportSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error("pull error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`server on :${PORT}`));
