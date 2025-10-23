---
include:
  - ./ruleset.md
  - ./version-control-v2.md
---

# vc_runbook.md

## objective
migrate from the codex_runbook (v2.5 linear snapshot demo) to **vc-core**, a local-first version control system with:
- always-present working commit (no HEAD pointer)
- hydrate (checkout) + merge functionality
- CLI + REST parity
- web viewer that mirrors local commits (github-like)

## deliverable
working CLI + local sqlite backend, exposing REST + web viewer  
deadline: saturday 12:00 local

---

## 0) repo scaffold (root)

/vc-core # pure module: repo, commits, merge logic
/server # REST + push/pull sync
/cli # CLI wrapper
/web # read-only viewer (React)

go
Copy code

root `.gitignore`:
node_modules
dist
.build
.env
.vc
server/.db.sqlite

go
Copy code

root `README.md`:
vc-core demo: local version control (sqlite + rest + react)

yaml
Copy code

---

## 1) core library (vc-core)

### 1.1 files

vc-core/
├── repo.ts # commit graph, trees, refs
├── diff.ts # two-way + three-way diffs
├── merge.ts # 3-way merge and conflict JSON
├── storage.ts # sqlite or JSON persistence
└── types.ts

php
Copy code

### 1.2 exposed API (TypeScript)

```ts
interface VCRepo {
  init(): Promise<void>;
  getWorking(): Promise<WorkingState>;
  commit(msg: string, source: "human"|"ai", aiMeta?: any): Promise<Commit>;
  hydrate(ref: string): Promise<void>;
  merge(ref: string): Promise<MergeResult>;
  log(): Promise<Commit[]>;
}

type WorkingState = { parentId: string; treeHash: string };
vc-core should be pure — no CLI or Express coupling.

2) CLI (local tool)
structure
pgsql
Copy code
cli/
  index.ts
sample commands
bash
Copy code
vc init
vc commit -m "first commit"
vc hydrate main
vc merge feature-x
vc log
implemented with commander

interacts with vc-core directly or via local HTTP (server optional)

stores data under .vc/ (sqlite or JSON)

test sequence
bash
Copy code
vc init
vc commit -m "hello world"
vc hydrate feature-x
vc merge main
vc log
expected:

.vc/ created with sqlite db

working table has parent pointer

commits table grows

merge produces conflict JSON if divergent

3) server (REST mirror)
responsibilities
serve commits / trees / diffs / merges

expose /push and /pull for sync

optional AI metadata storage

example endpoints
method	path	purpose
GET	/graph	return DAG of commits
POST	/commit	create new commit
POST	/hydrate	switch working commit
POST	/merge	perform merge
POST	/push	upload commits
GET	/pull	fetch latest

tech
express + drizzle + sqlite
server/db/schema.ts matches vc-core types.

4) web viewer
React + Cytoscape + Monaco diff tabs.

components
Graph.tsx — DAG view with merge edges

DiffTabs.tsx — tabs for ours, theirs, merged

CommitList.tsx — side panel with metadata

api.ts — REST helper

minimal flow
load /graph

render nodes + edges

on commit click → fetch diff + aiMeta

if merge → show three tabs

5) milestone plan
milestone	goal	output
M1	extract vc-core module	repo.ts + diff.ts
M2	CLI parity	init, commit, hydrate
M3	merge logic	3-way merge + conflicts
M4	REST + web viewer	DAG, diff tabs
M5	push/pull sync	local ↔ remote parity

6) validation
vc-core can be imported and run headless

CLI + REST produce identical commit graphs

working commit always exists (working table)

no HEAD pointer anywhere

merge creates commits with two parents

web viewer displays merged nodes and diffs

7) success checklist
☑ local sqlite repo with commits, trees, working
☑ CLI commands functional (init, commit, hydrate, merge)
☑ REST API mirrors local repo
☑ merge and diff visible in web UI
☑ push/pull sync between CLI + server
☑ no explicit HEAD ref — all derived from working state