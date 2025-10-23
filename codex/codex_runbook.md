codex_runbook.md

---
include:
  - ./ruleset.md
  - ./version-control.md
---


objective: implement a demo “vc” (version control) with metadata for ai/human edits, stored in sqlite, exposed via REST, visualized as a commit DAG. deliverable: working local demo: commit → see node on graph → view diff + ai metadata. deadline: saturday 12:00 local.

0) repo scaffold (root)

create folders:

/server
/client
/cli


create a root .gitignore with:

node_modules
dist
.build
.env
server/.db


root README.md with one-line: “demo vc with ai metadata (sqlite + rest + react).”

1) backend: server (express + drizzle + sqlite)
1.1 init + deps
cd server
bun init -y
bun add express zod drizzle-orm better-sqlite3
bun add -d tsx typescript @types/express

1.2 tsconfig

server/tsconfig.json

{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": ".build",
    "types": ["node"]
  },
  "include": ["./**/*.ts"]
}

1.3 drizzle schema

server/db/schema.ts

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sqliteTable, text, integer, blob, json } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const commits = sqliteTable("commits", {
  id: text("id").primaryKey(), // uuid or content-hash
  parentId: text("parent_id"),
  treeHash: text("tree_hash").notNull(),
  message: text("message").notNull(),
  author: text("author").notNull(),
  source: text("source").notNull(), // "human" | "ai"
  aiMeta: json("ai_meta").$type<{model?: string; reasoning?: string; diffSummary?: string}>(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
});

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  content: blob("content").notNull(), // store UTF-8 bytes
  size: integer("size").notNull(),
});

export const trees = sqliteTable("trees", {
  hash: text("hash").primaryKey(),
  files: json("files").$type<Record<string,string>>() // path -> blob hash
});

export const refs = sqliteTable("refs", {
  name: text("name").primaryKey(), // e.g. "main", "HEAD"
  commitId: text("commit_id")
});

export type DB = ReturnType<typeof getDb>;
export function getDb() {
  const sqlite = new Database(".db.sqlite");
  return drizzle(sqlite);
}

1.4 tiny migrations (idempotent)

server/db/migrate.ts

import { getDb } from "./schema";
const db = getDb();

// crude idempotent DDL
db.run(`
CREATE TABLE IF NOT EXISTS commits(
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  tree_hash TEXT NOT NULL,
  message TEXT NOT NULL,
  author TEXT NOT NULL,
  source TEXT NOT NULL,
  ai_meta TEXT,
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs(
  hash TEXT PRIMARY KEY,
  content BLOB NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trees(
  hash TEXT PRIMARY KEY,
  files TEXT
);
CREATE TABLE IF NOT EXISTS refs(
  name TEXT PRIMARY KEY,
  commit_id TEXT
);
`);
console.log("migrated");

1.5 utils: hashing + diff

server/utils/hash.ts

import { createHash } from "crypto";
export function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}


server/utils/diff.ts

import { diffLines } from "diff";
export function summarizeDiff(a: string, b: string) {
  const parts = diffLines(a, b);
  let adds = 0, dels = 0;
  for (const p of parts) { if (p.added) adds += (p.count ?? 0); if (p.removed) dels += (p.count ?? 0); }
  return { adds, dels };
}

1.6 http server

server/index.ts

import express from "express";
import { getDb, commits, blobs, trees, refs } from "./db/schema";
import { sha256 } from "./utils/hash";
import { summarizeDiff } from "./utils/diff";

const app = express();
app.use(express.json({ limit: "10mb" }));
const db = getDb();

// health
app.get("/health", (_,res)=>res.json({ok:true}));

// POST /init  -> create default refs (HEAD -> refs/heads/main), seed empty commit
app.post("/init", async (req, res) => {
  // empty tree
  const emptyTreeHash = "tree-" + sha256("{}");
  db.run(`INSERT OR IGNORE INTO trees(hash, files) VALUES(?, ?)`, emptyTreeHash, JSON.stringify({}));

  const firstCommitId = "c-" + sha256(emptyTreeHash + Date.now());
  const now = Date.now();
  db.run(`INSERT OR IGNORE INTO commits(id,parent_id,tree_hash,message,author,source,ai_meta,timestamp)
          VALUES(?,?,?,?,?,?,?,?)`,
          firstCommitId, null, emptyTreeHash, "init", "system", "human", null, now);
  db.run(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`, "refs/heads/main", firstCommitId);
  db.run(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`, "HEAD", firstCommitId);
  res.json({ head: firstCommitId, tree: emptyTreeHash });
});

// GET /refs
app.get("/refs", (req,res)=>{
  const rows = db.all(`SELECT name, commit_id FROM refs`);
  res.json(rows);
});

// POST /refs {name, commitId}
app.post("/refs", (req,res)=>{
  const { name, commitId } = req.body;
  db.run(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`, name, commitId);
  res.json({ ok: true });
});

// POST /snapshot { files: Record<path, string> } -> store blobs and a tree
app.post("/snapshot", (req,res)=>{
  const files: Record<string,string> = req.body?.files ?? {};
  const map: Record<string,string> = {};
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
app.get("/tree/:hash", (req,res)=>{
  const row = db.get(`SELECT files FROM trees WHERE hash = ?`, req.params.hash) as {files?: string} | undefined;
  if (!row) return res.status(404).json({error:"tree not found"});
  const mapping = JSON.parse(row.files ?? "{}") as Record<string,string>;
  const files: Record<string,string> = {};
  for (const [path, blobHash] of Object.entries(mapping)) {
    const b = db.get(`SELECT content FROM blobs WHERE hash = ?`, blobHash) as {content: Buffer} | undefined;
    if (b) files[path] = Buffer.from(b.content).toString("utf8");
  }
  res.json({ files });
});

// POST /commit {parentId, treeHash, message, author, source, aiMeta}
app.post("/commit", (req,res)=>{
  const { parentId, treeHash, message, author="you", source="human", aiMeta } = req.body ?? {};
  const id = "c-" + sha256([parentId, treeHash, message, author, source, JSON.stringify(aiMeta), Date.now()].join("|"));
  db.run(`INSERT INTO commits(id,parent_id,tree_hash,message,author,source,ai_meta,timestamp)
          VALUES(?,?,?,?,?,?,?,?)`,
          id, parentId ?? null, treeHash, message, author, source, aiMeta ? JSON.stringify(aiMeta) : null, Date.now());
  // move HEAD (and main) by default for demo
  db.run(`UPDATE refs SET commit_id = ? WHERE name IN ('HEAD','refs/heads/main')`, id);
  res.json({ id });
});

// GET /commits -> list with edges {id,parentId,...}
app.get("/commits", (req,res)=>{
  const rows = db.all(`SELECT id, parent_id as parentId, tree_hash as treeHash, message, author, source, ai_meta as aiMeta, timestamp FROM commits ORDER BY timestamp ASC`);
  res.json(rows.map(r => ({...r, aiMeta: r.aiMeta ? JSON.parse(r.aiMeta) : null })));
});

// POST /diff {olderTreeHash, newerTreeHash} -> { perFile: {path:{adds,dels}} }
app.post("/diff", (req,res)=>{
  const { olderTreeHash, newerTreeHash } = req.body;
  const oldRow = db.get(`SELECT files FROM trees WHERE hash = ?`, olderTreeHash) as any;
  const newRow = db.get(`SELECT files FROM trees WHERE hash = ?`, newerTreeHash) as any;
  if (!oldRow || !newRow) return res.status(400).json({error:"bad tree hash"});
  const oldMap = JSON.parse(oldRow.files ?? "{}") as Record<string,string>;
  const newMap = JSON.parse(newRow.files ?? "{}") as Record<string,string>;
  const paths = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
  const out: any = {};
  for (const p of paths) {
    const o = oldMap[p], n = newMap[p];
    const oldContent = o ? (db.get(`SELECT content FROM blobs WHERE hash = ?`, o) as any)?.content?.toString() ?? "" : "";
    const newContent = n ? (db.get(`SELECT content FROM blobs WHERE hash = ?`, n) as any)?.content?.toString() ?? "" : "";
    out[p] = summarizeDiff(oldContent, newContent);
  }
  res.json({ perFile: out });
});

const PORT = 3000;
app.listen(PORT, ()=> console.log(`server on :${PORT}`));

1.7 scripts

server/package.json add:

{
  "scripts": {
    "dev": "tsx watch index.ts",
    "migrate": "tsx db/migrate.ts",
    "init": "bun run migrate && curl -s -X POST localhost:3000/init > /dev/null || true"
  }
}

1.8 bring up server
bun run migrate
bun run dev
# in another shell:
bun run init
curl -s localhost:3000/health
curl -s localhost:3000/refs

2) frontend: client (react + cytoscape)
2.1 init + deps
cd ../client
bun create vite@latest client -- --template react-ts
bun add cytoscape ky

2.2 API helper

client/src/api.ts

import ky from "ky";
const api = ky.create({ prefixUrl: "http://localhost:3000" });

export async function getCommits() { return api.get("commits").json<any[]>(); }
export async function getRefs() { return api.get("refs").json<any[]>(); }
export async function postSnapshot(files: Record<string,string>) { return api.post("snapshot", { json:{ files } }).json<{treeHash:string}>(); }
export async function postCommit(body: any) { return api.post("commit", { json: body }).json<{id:string}>(); }
export async function getTree(hash: string) { return api.get(`tree/${hash}`).json<{files:Record<string,string>}>(); }
export async function postDiff(a: string, b: string) { return api.post("diff", { json:{ olderTreeHash:a, newerTreeHash:b } }).json<{perFile:any}>(); }

2.3 Graph component

client/src/components/Graph.tsx

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";

export function Graph({ commits }: { commits: any[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const nodes = commits.map(c => ({ data: { id: c.id, label: `${c.id.slice(0,6)}\n${c.source}` } }));
    const edges = commits.filter(c=>c.parentId).map(c => ({ data: { id: c.id+"->"+c.parentId, source: c.parentId, target: c.id }}));
    const cy = cytoscape({
      container: ref.current,
      elements: [...nodes, ...edges],
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.2 },
      style: [
        { selector: "node", style: { "label": "data(label)", "text-wrap": "wrap", "text-max-width": 80, "padding": 8, "shape": "round-rectangle" } },
        { selector: "edge", style: { "target-arrow-shape": "triangle", "curve-style": "bezier" } },
      ]
    });
    return () => cy.destroy();
  }, [commits]);
  return <div ref={ref} style={{ height: 400, border: "1px solid #ddd", borderRadius: 8 }} />;
}

2.4 App

client/src/App.tsx

import { useEffect, useState } from "react";
import { getCommits, getTree, postSnapshot, postCommit, postDiff } from "./api";
import { Graph } from "./components/Graph";

export default function App() {
  const [commits, setCommits] = useState<any[]>([]);
  const [text, setText] = useState<string>("console.log('hello');");
  const [head, setHead] = useState<any | null>(null);
  const [diff, setDiff] = useState<any>({});

  async function refresh() {
    const cs = await getCommits();
    setCommits(cs);
    setHead(cs.at(-1) ?? null);
  }
  useEffect(()=> { refresh(); }, []);

  async function doCommit(source: "human"|"ai") {
    // build tree from single file demo
    const snap = await postSnapshot({ "index.ts": text });
    const parentId = commits.at(-1)?.id ?? null;
    const payload = {
      parentId,
      treeHash: snap.treeHash,
      message: source === "ai" ? "AI edit" : "Human edit",
      author: "demo",
      source,
      aiMeta: source === "ai" ? { model: "gpt-5", reasoning: "refactor", diffSummary: "minor changes" } : null
    };
    const res = await postCommit(payload);
    await refresh();

    // compute diff vs previous tree if exists
    const prevTree = head?.treeHash;
    if (prevTree) {
      const d = await postDiff(prevTree, snap.treeHash);
      setDiff(d.perFile);
    }
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>vc demo</h2>
      <Graph commits={commits} />
      <textarea value={text} onChange={e=>setText(e.target.value)} style={{ width:"100%", height:160 }} />
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>doCommit("human")}>commit (human)</button>
        <button onClick={()=>doCommit("ai")}>commit (ai)</button>
      </div>
      <pre style={{ background:"#f7f7f7", padding:12, borderRadius:8 }}>
        {JSON.stringify(diff, null, 2)}
      </pre>
    </div>
  );
}

2.5 run
bun run dev
# open http://localhost:5173

3) CLI: thin wrapper over REST
3.1 init + deps
cd ../cli
bun init -y
bun add commander ky

3.2 code

cli/index.ts

#!/usr/bin/env bun
import { Command } from "commander";
import ky from "ky";

const api = ky.create({ prefixUrl: "http://localhost:3000" });
const program = new Command();
program.name("vc").description("demo vc cli");

program.command("init").action(async ()=>{
  await api.post("init").text();
  console.log("initialized");
});

program.command("commit")
  .requiredOption("-m, --message <msg>")
  .option("--source <source>", "human")
  .action(async (opts)=>{
    // for CLI demo, we snapshot a single file from disk (index.ts if present)
    let content = "console.log('cli');";
    try {
      content = await Bun.file("index.ts").text();
    } catch {}
    const { treeHash } = await api.post("snapshot", { json:{ files: { "index.ts": content } } }).json<any>();
    const commits = await api.get("commits").json<any[]>();
    const parentId = commits.at(-1)?.id ?? null;
    const body = { parentId, treeHash, message: opts.message, author: "cli", source: opts.source };
    const res = await api.post("commit", { json: body }).json<any>();
    console.log("Committed", res.id);
  });

program.command("log").action(async ()=>{
  const cs = await api.get("commits").json<any[]>();
  for (const c of cs) console.log(`${c.id.slice(0,7)} ${new Date(c.timestamp).toISOString()} ${c.source} ${c.message}`);
});

await program.parseAsync();

3.3 make executable

package.json:

{ "bin": { "vc": "index.ts" }, "type": "module" }


then

bun link
vc init
vc commit -m "first from cli"
vc log

4) deterministic checks (must pass)

server up: curl -s localhost:3000/health → {"ok":true}

after POST /init: GET /refs has HEAD and refs/heads/main

after committing in client: GET /commits length increases

graph shows new node; diff panel shows adds/dels counts

vc log prints same commits as /commits

5) API contracts (zod implied; treat as schema)

POST /init → { head: string; tree: string }

GET /refs → { name: string; commit_id: string }[]

POST /refs { name, commitId } → { ok: true }

POST /snapshot { files: Record<string,string> } → { treeHash: string }

GET /tree/:hash → { files: Record<string,string> }

POST /commit { parentId?: string, treeHash: string, message: string, author: string, source: "human"|"ai", aiMeta?: {...} } → { id: string }

GET /commits → Commit[] (ordered asc)

POST /diff { olderTreeHash, newerTreeHash } → { perFile: Record<path,{adds:number,dels:number}> }

6) stretch (optional, only if time allows)

swap textarea → Monaco editor.

websocket push on commit.

migrate sqlite → supabase: keep same tables; use text + jsonb analogs; replace better-sqlite3 with @supabase/postgrest-js or postgres + drizzle pg dialect.