import { getDb } from "./schema";
const db = getDb();

// crude idempotent DDL
db.exec(`
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
