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
app.get("/refs", (_req, res) => {
  const rows = db.all<{ name: string; commit_id: string }>(`SELECT name, commit_id FROM refs`);
  res.json(rows);
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
app.get("/tree/:hash", (req, res) => {
  const row = db.get<{ files?: string }>(`SELECT files FROM trees WHERE hash = ?`, req.params.hash);
  if (!row) return res.status(404).json({ error: "tree not found" });
  const mapping = JSON.parse(row.files ?? "{}") as Record<string, string>;
  const files: Record<string, string> = {};
  for (const [path, blobHash] of Object.entries(mapping)) {
    const b = db.get<{ content: Buffer }>(`SELECT content FROM blobs WHERE hash = ?`, blobHash);
    if (b) files[path] = Buffer.from(b.content).toString("utf8");
  }
  res.json({ files });
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
app.get("/commits", (_req, res) => {
  const rows = db.all<{
    id: string;
    parent_id: string | null;
    tree_hash: string;
    message: string;
    author: string;
    source: string;
    ai_meta: string | null;
    timestamp: number;
  }>(
    `SELECT id, parent_id, tree_hash, message, author, source, ai_meta, timestamp FROM commits ORDER BY timestamp ASC`,
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      treeHash: r.tree_hash,
      message: r.message,
      author: r.author,
      source: r.source,
      aiMeta: r.ai_meta ? JSON.parse(r.ai_meta) : null,
      timestamp: r.timestamp,
    })),
  );
});

// POST /diff {olderTreeHash, newerTreeHash} -> { perFile: {path:{adds,dels}} }
app.post("/diff", (req, res) => {
  const { olderTreeHash, newerTreeHash } = req.body;
  const oldRow = db.get<{ files: string }>(`SELECT files FROM trees WHERE hash = ?`, olderTreeHash);
  const newRow = db.get<{ files: string }>(`SELECT files FROM trees WHERE hash = ?`, newerTreeHash);
  if (!oldRow || !newRow) return res.status(400).json({ error: "bad tree hash" });
  const oldMap = JSON.parse(oldRow.files ?? "{}") as Record<string, string>;
  const newMap = JSON.parse(newRow.files ?? "{}") as Record<string, string>;
  const paths = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
  const out: Record<string, { adds: number; dels: number }> = {};
  for (const p of paths) {
    const o = oldMap[p];
    const n = newMap[p];
    const oldContent =
      o !== undefined
        ? (db.get<{ content: Buffer }>(`SELECT content FROM blobs WHERE hash = ?`, o)?.content ?? Buffer.from("")).toString(
            "utf8",
          )
        : "";
    const newContent =
      n !== undefined
        ? (db.get<{ content: Buffer }>(`SELECT content FROM blobs WHERE hash = ?`, n)?.content ?? Buffer.from("")).toString(
            "utf8",
          )
        : "";
    out[p] = summarizeDiff(oldContent, newContent);
  }
  res.json({ perFile: out });
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
