version-control.md
project goal

build a minimal version control system with metadata capturing ai + human edits, and a visual commit graph.
goal: working demo by saturday — show commits, metadata, and visual diff tree.

architecture overview
/server
  ├── index.ts          # express entrypoint
  ├── db/
  │     ├── schema.ts   # drizzle schema (objects, commits, refs)
  │     └── seed.ts     # optional: seed example data
  ├── routes/
  │     ├── commits.ts  # POST /commit, GET /commits
  │     ├── refs.ts     # GET /refs, POST /refs
  │     └── files.ts    # POST /snapshot, GET /snapshot/:id
  └── utils/
        ├── diff.ts     # compute text diff summaries
        └── hash.ts     # sha256 or content hash helper

/client
  ├── src/
  │     ├── App.tsx
  │     ├── api.ts      # fetches commits, refs
  │     ├── components/
  │     │     ├── Graph.tsx    # renders DAG with cytoscape.js or d3
  │     │     ├── CommitCard.tsx
  │     │     └── DiffViewer.tsx
  │     └── pages/
  │           ├── Timeline.tsx
  │           └── Editor.tsx   # simulate editing + committing

db schema (drizzle)
import { sqliteTable, text, integer, json } from "drizzle-orm/sqlite-core"

export const commits = sqliteTable("commits", {
  id: text("id").primaryKey(), // uuid or hash
  parentId: text("parent_id").references(() => commits.id),
  treeHash: text("tree_hash"),
  message: text("message"),
  author: text("author"),
  source: text("source"), // "human" | "ai"
  aiMeta: json("ai_meta").$type<{
    model?: string
    reasoning?: string
    diffSummary?: string
  }>(),
  timestamp: integer("timestamp", { mode: "timestamp" }),
})

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  content: text("content"),
})

export const trees = sqliteTable("trees", {
  hash: text("hash").primaryKey(),
  files: json("files").$type<{ [path: string]: string }>(), // path -> blob hash
})

export const refs = sqliteTable("refs", {
  name: text("name").primaryKey(), // e.g. "main"
  commitId: text("commit_id").references(() => commits.id),
})

endpoints
method	route	purpose
POST /commit	create commit with ai/human metadata	
GET /commits	return all commits + refs for graph	
GET /commit/:id	return single commit details	
POST /snapshot	save new file content, return blob + tree hash	
GET /tree/:hash	get snapshot of files	
GET /refs	list refs + current head	
POST /refs	update branch pointer	
commit flow

user edits code in editor (simulate with textarea)

on “commit” button:

compute hash of file

POST /snapshot

POST /commit with payload:

{
  "parentId": "abc123",
  "treeHash": "def456",
  "message": "refactor login route",
  "source": "ai",
  "aiMeta": {
    "model": "gpt-5",
    "reasoning": "improved readability",
    "diffSummary": "renamed vars, added types"
  }
}


backend inserts commit + returns updated DAG.

frontend logic
Graph.tsx

render commits as nodes in a directed graph (using cytoscape.js):

node label: commit id short + author/source

edge: parent → child

on hover: show commit message + ai meta tooltip

DiffViewer.tsx

simple two-pane diff viewer:

old vs new snapshot

highlight line additions/removals (use diff2html or jsdiff)

Editor.tsx

mock text editor (textarea) + commit button:

lets user write code

simulate “AI Edit” that mutates text and auto-commits.

cli (optional)
basic commands
vc init
vc commit -m "message" --source ai --reason "refactor"
vc log
vc checkout <commit_id>


all these call REST endpoints behind the scenes.

implementation

create cli/index.ts with commander:

import { program } from "commander"
import { commit, log, checkout } from "./api"

program
  .command("commit")
  .option("-m, --message <msg>")
  .option("--source <source>")
  .action(async (opts) => { await commit(opts) })

stretch goals

syntax highlighting editor (monaco)

branch merging visualization

persistent supabase backend

auth (for multiple users)

setup commands
# backend
bun create drizzle-app
bun install express drizzle-orm better-sqlite3
bun run dev

# frontend
bun create vite@latest client --template react-ts
bun install cytoscape diff2html
bun run dev

mvp deliverable checklist

 drizzle schema + migrations working

 can POST /commit and store metadata

 frontend graph renders commits

 diff viewer shows changes

 ai metadata visible in tooltip