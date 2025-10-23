import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";

export const commits = sqliteTable("commits", {
  id: text("id").primaryKey(), // uuid or content-hash
  parentId: text("parent_id"),
  treeHash: text("tree_hash").notNull(),
  message: text("message").notNull(),
  author: text("author").notNull(),
  source: text("source").notNull(), // "human" | "ai"
  aiMeta: text("ai_meta", { mode: "json" }).$type<{ model?: string; reasoning?: string; diffSummary?: string } | null>(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
});

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  content: blob("content").notNull(), // store UTF-8 bytes
  size: integer("size").notNull(),
});

export const trees = sqliteTable("trees", {
  hash: text("hash").primaryKey(),
  files: text("files", { mode: "json" }).$type<Record<string, string>>(), // path -> blob hash
});

export const refs = sqliteTable("refs", {
  name: text("name").primaryKey(), // e.g. "main", "HEAD"
  commitId: text("commit_id"),
});

const sqlite = new Database(".db.sqlite");
export const db = drizzle(sqlite);

export type DB = ReturnType<typeof getDb>;
export function getDb() {
  return {
    run(sql: string, ...params: any[]) {
      return sqlite.prepare(sql).run(...params);
    },
    get<T = any>(sql: string, ...params: any[]) {
      return sqlite.prepare(sql).get(...params) as T | undefined;
    },
    all<T = any>(sql: string, ...params: any[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    exec(sql: string) {
      return sqlite.exec(sql);
    },
  };
}
