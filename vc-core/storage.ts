import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Commit, FileMap, WorkingState } from "./types";

export interface BlobRecord {
  hash: string;
  content: Buffer;
  size: number;
}

export interface TreeRecord {
  hash: string;
  files: Record<string, string>;
}

export interface StorageAdapter {
  init(): Promise<void>;
  clear(): Promise<void>;
  saveBlob(blob: BlobRecord): Promise<void>;
  getBlob(hash: string): Promise<BlobRecord | null>;
  listBlobs(): Promise<BlobRecord[]>;
  saveTree(tree: TreeRecord): Promise<void>;
  getTree(hash: string): Promise<TreeRecord | null>;
  listTrees(): Promise<TreeRecord[]>;
  saveCommit(commit: Commit): Promise<void>;
  getCommit(id: string): Promise<Commit | null>;
  listCommits(): Promise<Commit[]>;
  getWorkingState(): Promise<WorkingState | null>;
  setWorkingState(state: WorkingState): Promise<void>;
  getRef(name: string): Promise<string | null>;
  setRef(name: string, commitId: string): Promise<void>;
  listRefs(): Promise<Record<string, string>>;
  resolveRef(ref: string): Promise<string | null>;
}

export function createInMemoryStorage(): StorageAdapter {
  const commits = new Map<string, Commit>();
  const trees = new Map<string, TreeRecord>();
  const blobs = new Map<string, BlobRecord>();
  const refs = new Map<string, string>();
  let working: WorkingState | null = null;

  return {
    async init() {
      // no-op
    },
    async clear() {
      commits.clear();
      trees.clear();
      blobs.clear();
      refs.clear();
      working = null;
    },
    async saveBlob(blob) {
      blobs.set(blob.hash, blob);
    },
    async getBlob(hash) {
      return blobs.get(hash) ?? null;
    },
    async listBlobs() {
      return Array.from(blobs.values()).map((blob) => ({
        hash: blob.hash,
        content: Buffer.from(blob.content),
        size: blob.size,
      }));
    },
    async saveTree(tree) {
      trees.set(tree.hash, { ...tree, files: { ...tree.files } });
    },
    async getTree(hash) {
      const tree = trees.get(hash);
      return tree ? { hash: tree.hash, files: { ...tree.files } } : null;
    },
    async listTrees() {
      return Array.from(trees.values()).map((tree) => ({ hash: tree.hash, files: { ...tree.files } }));
    },
    async saveCommit(commit) {
      commits.set(commit.id, { ...commit, parents: [...commit.parents] });
    },
    async getCommit(id) {
      const c = commits.get(id);
      return c ? { ...c, parents: [...c.parents] } : null;
    },
    async listCommits() {
      return Array.from(commits.values())
        .map((c) => ({ ...c, parents: [...c.parents] }))
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    async getWorkingState() {
      return working ? { ...working } : null;
    },
    async setWorkingState(state) {
      working = { ...state };
    },
    async getRef(name) {
      return refs.get(name) ?? null;
    },
    async setRef(name, commitId) {
      refs.set(name, commitId);
    },
    async listRefs() {
      return Object.fromEntries(refs.entries());
    },
    async resolveRef(ref) {
      if (!ref) return null;
      if (commits.has(ref)) return ref;
      const refTarget = refs.get(ref);
      if (refTarget) return refTarget;
      const matches = Array.from(commits.keys()).filter((id) => id.startsWith(ref));
      if (matches.length === 1) return matches[0]!;
      return null;
    },
  };
}

export interface SqliteStorageConfig {
  rootDir: string;
  filename?: string;
}

export function createSqliteStorage(config: SqliteStorageConfig): StorageAdapter {
  const filename = config.filename ?? "repo.sqlite";
  const dbPath = path.join(config.rootDir, filename);
  let db: Database.Database | null = null;

  const escapeLikePattern = (input: string) => input.replace(/([%_\\])/g, "\\$1");

  const ensureDb = () => {
    if (!db) {
      fs.mkdirSync(config.rootDir, { recursive: true });
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
    }
    return db
    
    ;
  };

  const serializeFiles = (files: Record<string, string>) => JSON.stringify(files);
  const deserializeFiles = (input: string | null) => {
    if (!input) return {};
    return JSON.parse(input) as FileMap;
  };

  const getRefValue = (name: string) => {
    const database = ensureDb();
    const row = database
      .prepare(`SELECT commit_id as commitId FROM refs WHERE name = ?`)
      .get(name) as { commitId: string } | undefined;
    return row?.commitId ?? null;
  };

  return {
    async init() {
      const database = ensureDb();
      database.exec(`
        CREATE TABLE IF NOT EXISTS commits(
          id TEXT PRIMARY KEY,
          parents TEXT NOT NULL,
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
          files TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS refs(
          name TEXT PRIMARY KEY,
          commit_id TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS working(
          id INTEGER PRIMARY KEY,
          parent_id TEXT,
          tree_hash TEXT
        );
      `);

      database
        .prepare(`INSERT OR IGNORE INTO working(id, parent_id, tree_hash) VALUES (1, NULL, NULL)`)
        .run();
    },
    async clear() {
      const database = ensureDb();
      database.exec(`
        DELETE FROM commits;
        DELETE FROM trees;
        DELETE FROM blobs;
        DELETE FROM refs;
        UPDATE working SET parent_id = NULL, tree_hash = NULL WHERE id = 1;
      `);
    },
    async saveBlob(blob) {
      const database = ensureDb();
      database
        .prepare(`INSERT OR REPLACE INTO blobs(hash, content, size) VALUES (?, ?, ?)`)
        .run(blob.hash, blob.content, blob.size);
    },
    async getBlob(hash) {
      const database = ensureDb();
      const row = database
        .prepare(`SELECT hash, content, size FROM blobs WHERE hash = ?`)
        .get(hash) as { hash: string; content: Buffer; size: number } | undefined;
      return row ? { hash: row.hash, content: row.content, size: row.size } : null;
    },
    async listBlobs() {
      const database = ensureDb();
      const rows = database
        .prepare(`SELECT hash, content, size FROM blobs`)
        .all() as Array<{ hash: string; content: Buffer; size: number }>;
      return rows.map((row) => ({ hash: row.hash, content: row.content, size: row.size }));
    },
    async saveTree(tree) {
      const database = ensureDb();
      database
        .prepare(`INSERT OR REPLACE INTO trees(hash, files) VALUES (?, ?)`)
        .run(tree.hash, serializeFiles(tree.files));
    },
    async getTree(hash) {
      const database = ensureDb();
      const row = database
        .prepare(`SELECT hash, files FROM trees WHERE hash = ?`)
        .get(hash) as { hash: string; files: string } | undefined;
      return row ? { hash: row.hash, files: deserializeFiles(row.files) } : null;
    },
    async listTrees() {
      const database = ensureDb();
      const rows = database
        .prepare(`SELECT hash, files FROM trees`)
        .all() as Array<{ hash: string; files: string }>;
      return rows.map((row) => ({ hash: row.hash, files: deserializeFiles(row.files) }));
    },
    async saveCommit(commit) {
      const database = ensureDb();
      database
        .prepare(
          `INSERT OR REPLACE INTO commits(id, parents, tree_hash, message, author, source, ai_meta, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          commit.id,
          JSON.stringify(commit.parents),
          commit.treeHash,
          commit.message,
          commit.author,
          commit.source,
          commit.aiMeta ? JSON.stringify(commit.aiMeta) : null,
          commit.timestamp,
        );
    },
    async getCommit(id) {
      const database = ensureDb();
      const row = database
        .prepare(
          `SELECT id, parents, tree_hash as treeHash, message, author, source, ai_meta as aiMeta, timestamp
           FROM commits WHERE id = ?`,
        )
        .get(id) as
        | {
            id: string;
            parents: string;
            treeHash: string;
            message: string;
            author: string;
            source: string;
            aiMeta: string | null;
            timestamp: number;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        parents: JSON.parse(row.parents) as string[],
        treeHash: row.treeHash,
        message: row.message,
        author: row.author,
        source: row.source as Commit["source"],
        aiMeta: row.aiMeta ? (JSON.parse(row.aiMeta) as Record<string, unknown>) : null,
        timestamp: row.timestamp,
      };
    },
    async listCommits() {
      const database = ensureDb();
      const rows = database
        .prepare(
          `SELECT id, parents, tree_hash as treeHash, message, author, source, ai_meta as aiMeta, timestamp
           FROM commits ORDER BY timestamp ASC`,
        )
        .all() as Array<{
        id: string;
        parents: string;
        treeHash: string;
        message: string;
        author: string;
        source: string;
        aiMeta: string | null;
        timestamp: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        parents: JSON.parse(row.parents) as string[],
        treeHash: row.treeHash,
        message: row.message,
        author: row.author,
        source: row.source as Commit["source"],
        aiMeta: row.aiMeta ? (JSON.parse(row.aiMeta) as Record<string, unknown>) : null,
        timestamp: row.timestamp,
      }));
    },
    async getWorkingState() {
      const database = ensureDb();
      const row = database
        .prepare(`SELECT parent_id as parentId, tree_hash as treeHash FROM working WHERE id = 1`)
        .get() as { parentId: string | null; treeHash: string | null } | undefined;
      if (!row || !row.treeHash) return null;
      return { parentId: row.parentId, treeHash: row.treeHash };
    },
    async setWorkingState(state) {
      const database = ensureDb();
      database
        .prepare(`UPDATE working SET parent_id = ?, tree_hash = ? WHERE id = 1`)
        .run(state.parentId ?? null, state.treeHash);
    },
    async getRef(name) {
      return getRefValue(name);
    },
    async setRef(name, commitId) {
      const database = ensureDb();
      database.prepare(`INSERT OR REPLACE INTO refs(name, commit_id) VALUES(?, ?)`).run(name, commitId);
    },
    async listRefs() {
      const database = ensureDb();
      const rows = database
        .prepare(`SELECT name, commit_id as commitId FROM refs`)
        .all() as Array<{ name: string; commitId: string }>;
      return rows.reduce<Record<string, string>>((acc, row) => {
        acc[row.name] = row.commitId;
        return acc;
      }, {});
    },
    async resolveRef(ref) {
      if (!ref) return null;
      const database = ensureDb();
      const commitExists = database
        .prepare(`SELECT 1 FROM commits WHERE id = ? LIMIT 1`)
        .get(ref) as { 1: number } | undefined;
      if (commitExists) return ref;
      const refValue = getRefValue(ref);
      if (refValue) return refValue;
      const prefix = escapeLikePattern(ref);
      const matches = database
        .prepare(`SELECT id FROM commits WHERE id LIKE ? ESCAPE '\\'`)
        .all(`${prefix}%`) as Array<{ id: string }>;
      if (matches.length === 1) return matches[0]!.id;
      return null;
    },
  };
}
