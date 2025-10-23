objective

evolve the current demo into a CLI-driven local version control system (“vc-core”) with a companion web viewer (similar to a lightweight GitHub).
the system must maintain an always-up-to-date working commit, support hydrate (checkout) and merge operations, and expose its state via a REST API and CLI.

high-level architecture
vc-core/               # pure TypeScript module (no side effects)
  ├─ repo.ts           # commit graph, refs, trees, merges
  ├─ storage.ts        # sqlite/local persistence
  ├─ diff.ts           # 3-way + 2-way diff utils
  └─ types.ts

server/                # REST + sync layer
  ├─ index.ts          # exposes repo state
  └─ db/schema.ts

cli/                   # local command tool
  └─ index.ts

web/                   # read-only viewer (React)
  ├─ Graph.tsx
  ├─ DiffTabs.tsx
  ├─ CommitList.tsx
  └─ api.ts

data model (sqlite via drizzle)
export const commits = sqliteTable("commits", {
  id: text("id").primaryKey(),
  parentIds: json("parents").$type<string[]>(), // multiple for merges
  treeHash: text("tree_hash").notNull(),
  message: text("message").notNull(),
  author: text("author").notNull(),
  source: text("source").notNull(), // human | ai | system
  aiMeta: json("ai_meta").$type<{ model?: string; reasoning?: string; diffSummary?: string }>(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
});

export const trees = sqliteTable("trees", {
  hash: text("hash").primaryKey(),
  files: json("files").$type<Record<string, string>>(), // path → blob hash
});

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  content: blob("content").notNull(),
  size: integer("size").notNull(),
});

export const refs = sqliteTable("refs", {
  name: text("name").primaryKey(), // e.g. main, feature/x, HEAD
  commitId: text("commit_id").notNull(),
});

export const working = sqliteTable("working", {
  id: integer("id").primaryKey(), // always 1
  parentId: text("parent_id"),
  treeHash: text("tree_hash"),
});

command semantics
vc init

create .vc/ directory

initialize empty tree + first commit

create refs:

refs/heads/main → first commit

HEAD → same commit

working → parent = HEAD

vc status

compare working tree vs HEAD; show modified/new/deleted paths.

vc commit -m "msg"

snapshot working tree → new immutable commit

set new commit’s parent = working.parentId

move both HEAD and active branch ref to new commit

reset working.parentId = new commit

vc hydrate <ref>

load commit tree into working state (replaces current files)

set working.parentId = <ref>

vc merge <ref>

find common ancestor between working.parentId and <ref>

compute 3-way diff

auto-resolve non-conflicting paths

store merged tree as new commit with two parents [ours, theirs]

conflicts output to web UI / CLI (JSON).

vc push / vc pull

sync .vc/ metadata and blobs with remote server (the web viewer backend).

REST API additions
method	route	description
GET	/graph	returns commit DAG (for viewer)
POST	/hydrate	set working commit from ref
POST	/merge	perform merge, return diff/conflicts
GET	/working	current working commit info
POST	/push	upload new commits/blobs to remote
GET	/pull	fetch latest from remote
frontend changes (web viewer)

DiffTabs.tsx → three tabs: ours, theirs, merged

Graph.tsx → show multiple parents (merge nodes with double arrows)

CommitList.tsx → right panel with metadata + AI tags

optional branch selector for hydrate.

CLI workflow example
vc init
vc commit -m "initial human edit"
vc hydrate feature-x
vc commit -m "AI refactor" --source ai
vc merge main
vc push

sync model

local .vc/ folder uses sqlite.
server mirrors the same schema and exposes push/pull endpoints.
a simple diff of commit IDs ensures idempotent sync.

roadmap (v3 goals)
milestone	focus	output
M1	extract pure vc-core lib	repo CRUD, commit graph
M2	implement working commit + hydrate	CLI + REST parity
M3	add merge + conflict JSON	3-way diff working
M4	new web viewer (Graph + DiffTabs)	DAG w/ merges
M5	push/pull sync	local ↔ remote parity
M6	polish: auth, supabase backend	optional multiuser
success criteria

CLI and web stay in sync (commits created from either appear in both)

working commit autosaves edits and always exists

hydrate and merge functional on at least text-level diffs

DAG visualizer reflects merge edges

all persisted in sqlite and mirrored to server.