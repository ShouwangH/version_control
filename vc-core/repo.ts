import { createHash } from "crypto";
import path from "node:path";
import { createInMemoryStorage, createSqliteStorage } from "./storage";
import type { StorageAdapter, SqliteStorageConfig } from "./storage";
import type {
  Commit,
  CommitSource,
  FileMap,
  MergeConflict,
  MergeResult,
  RepoSnapshot,
  VCRepo,
  WorkingState,
} from "./types";

export interface RepoConfig {
  storage?: StorageAdapter;
  author?: string;
  clock?: () => number;
  hash?: (input: string | Buffer) => string;
  defaultBranch?: string;
}

const EMPTY_TREE_FILES: FileMap = {};
const DEFAULT_BRANCH_REF = "refs/heads/main";
const HEAD_REF = "HEAD";

class RepoImpl implements VCRepo {
  private readonly storage: StorageAdapter;
  private readonly author: string;
  private readonly clock: () => number;
  private readonly hashFn: (input: string | Buffer) => string;
  private readonly defaultBranch: string;
  private initialized = false;

  constructor(config: RepoConfig = {}) {
    this.storage = config.storage ?? createInMemoryStorage();
    this.author = config.author ?? "system";
    this.clock = config.clock ?? Date.now;
    this.hashFn = config.hash ?? defaultHash;
    this.defaultBranch = config.defaultBranch ?? DEFAULT_BRANCH_REF;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this.storage.init();
    const existingWorking = await this.storage.getWorkingState();

    if (!existingWorking) {
      const timestamp = this.clock();
      const treeHash = this.computeTreeHash(EMPTY_TREE_FILES);
      await this.storage.saveTree({ hash: treeHash, files: EMPTY_TREE_FILES });
      const commit: Commit = {
        id: this.generateCommitId([], treeHash, "init", timestamp),
        parents: [],
        treeHash,
        message: "init",
        author: this.author,
        source: "system",
        aiMeta: null,
        timestamp,
      };
      await this.storage.saveCommit(commit);
      await this.storage.setRef(this.defaultBranch, commit.id);
      await this.storage.setRef(HEAD_REF, commit.id);
      await this.storage.setWorkingState({ parentId: commit.id, treeHash: commit.treeHash });
    }

    this.initialized = true;
  }

  async getWorking(): Promise<WorkingState> {
    await this.ensureReady();
    const working = await this.storage.getWorkingState();
    if (!working) {
      throw new Error("Working state is not initialized");
    }
    return working;
  }

  async snapshot(files: FileMap): Promise<WorkingState> {
    await this.ensureReady();
    const working = await this.getWorking();
    const entries = this.sanitizeFileEntries(files);
    const treeHash = await this.persistEntries(entries);

    const nextState: WorkingState = { parentId: working.parentId, treeHash };
    await this.storage.setWorkingState(nextState);
    return nextState;
  }

  async commit(
    message: string,
    source: CommitSource,
    aiMeta: Record<string, unknown> | null = null,
  ): Promise<Commit> {
    await this.ensureReady();
    const working = await this.getWorking();
    const timestamp = this.clock();
    const parents = working.parentId ? [working.parentId] : [];
    const id = this.generateCommitId(parents, working.treeHash, message, timestamp, aiMeta);

    const commit: Commit = {
      id,
      parents,
      treeHash: working.treeHash,
      message,
      author: this.author,
      source,
      aiMeta,
      timestamp,
    };

    await this.storage.saveCommit(commit);
    await this.storage.setWorkingState({ parentId: commit.id, treeHash: working.treeHash });
    await this.storage.setRef(this.defaultBranch, commit.id);
    await this.storage.setRef(HEAD_REF, commit.id);
    return commit;
  }

  async hydrate(ref: string): Promise<FileMap> {
    await this.ensureReady();
    const commit = await this.resolveCommit(ref);
    const files = await this.loadTreeContents(commit.treeHash);
    await this.storage.setWorkingState({ parentId: commit.id, treeHash: commit.treeHash });
    await this.storage.setRef(HEAD_REF, commit.id);
    return files;
  }

  async merge(ref: string): Promise<MergeResult> {
    await this.ensureReady();
    const working = await this.getWorking();
    if (!working.parentId) {
      throw new Error("Cannot merge without an existing commit in the working state");
    }

    const oursCommit = await this.getCommitOrThrow(working.parentId);
    const theirsCommit = await this.resolveCommit(ref);

    if (oursCommit.id === theirsCommit.id) {
      const files = await this.loadTreeContents(oursCommit.treeHash);
      return { mergedTreeHash: oursCommit.treeHash, conflicts: [], mergedFiles: files, commitId: null };
    }

    const baseCommit = await this.findCommonAncestor(oursCommit.id, theirsCommit.id);
    const baseFiles = baseCommit ? await this.loadTreeContents(baseCommit.treeHash) : {};
    const oursFiles = await this.loadTreeContents(working.treeHash);
    const theirsFiles = await this.loadTreeContents(theirsCommit.treeHash);

    const { merged, conflicts } = this.mergeFileMaps(baseFiles, oursFiles, theirsFiles);
    if (conflicts.length > 0) {
      return { mergedTreeHash: null, conflicts, mergedFiles: null, commitId: null };
    }

    const entries = this.sanitizeFileEntries(merged);
    const treeHash = await this.persistEntries(entries);
    const timestamp = this.clock();
    const mergeMessage = `merge ${ref}`;
    const commitId = this.generateCommitId(
      [oursCommit.id, theirsCommit.id],
      treeHash,
      mergeMessage,
      timestamp,
      null,
    );
    const mergeCommit: Commit = {
      id: commitId,
      parents: [oursCommit.id, theirsCommit.id],
      treeHash,
      message: mergeMessage,
      author: this.author,
      source: "system",
      aiMeta: null,
      timestamp,
    };

    await this.storage.saveCommit(mergeCommit);
    await this.storage.setWorkingState({ parentId: mergeCommit.id, treeHash });
    await this.storage.setRef(this.defaultBranch, mergeCommit.id);
    await this.storage.setRef(HEAD_REF, mergeCommit.id);

    return { mergedTreeHash: treeHash, conflicts: [], mergedFiles: merged, commitId };
  }

  async log(): Promise<Commit[]> {
    await this.ensureReady();
    return this.storage.listCommits();
  }

  async exportSnapshot(): Promise<RepoSnapshot> {
    await this.ensureReady();
    const commits = await this.storage.listCommits();
    const trees = await this.storage.listTrees();
    const blobs = await this.storage.listBlobs();
    const refs = await this.storage.listRefs();

    return {
      commits,
      trees: trees.map((tree) => ({ hash: tree.hash, files: { ...tree.files } })),
      blobs: blobs.map((blob) => ({
        hash: blob.hash,
        size: blob.size,
        content: Buffer.from(blob.content).toString("base64"),
      })),
      refs,
    };
  }

  async importSnapshot(snapshot: RepoSnapshot): Promise<void> {
    await this.ensureReady();

    for (const blob of snapshot.blobs) {
      const buffer = Buffer.from(blob.content, "base64");
      await this.storage.saveBlob({ hash: blob.hash, content: buffer, size: blob.size ?? buffer.length });
    }

    for (const tree of snapshot.trees) {
      await this.storage.saveTree({ hash: tree.hash, files: { ...tree.files } });
    }

    for (const commit of snapshot.commits) {
      await this.storage.saveCommit(commit);
    }

    for (const [name, commitId] of Object.entries(snapshot.refs)) {
      await this.storage.setRef(name, commitId);
    }

    const headCommitId = snapshot.refs[HEAD_REF];
    if (headCommitId) {
      const headCommit = await this.getCommitOrThrow(headCommitId);
      await this.storage.setWorkingState({ parentId: headCommit.id, treeHash: headCommit.treeHash });
    }
  }

  private async ensureReady() {
   if (!this.initialized) {
      await this.init();
    }
  }

  private computeTreeHash(files: FileMap) {
    return `tree-${this.hashFn(this.serializeFiles(files))}`;
  }

  private computeTreeHashWithBlobs(files: FileMap) {
    return this.computeTreeHash(files);
  }

  private generateCommitId(
    parents: string[],
    treeHash: string,
    message: string,
    timestamp: number,
    aiMeta?: Record<string, unknown> | null,
  ) {
    const payload = JSON.stringify({ parents, treeHash, message, timestamp, aiMeta });
    return `c-${this.hashFn(payload)}`;
  }

  private generateBlobHash(content: Buffer) {
    return `blob-${this.hashFn(content)}`;
  }

  private serializeFiles(files: FileMap) {
    const sortedEntries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(sortedEntries));
  }

  private sanitizeFileEntries(files: FileMap) {
    const entries = Object.entries(files)
      .map(([pathName, content]) => [pathName.replace(/\\/g, "/"), content] as [string, string])
      .filter(([pathName]) => pathName.length > 0);

    const deduped = new Map<string, string>();
    for (const [pathName, content] of entries) {
      deduped.set(pathName, content);
    }

    return Array.from(deduped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }

  private async persistEntries(entries: Array<[string, string]>) {
    const blobMap: Record<string, string> = {};
    for (const [filePath, content] of entries) {
      const buffer = Buffer.from(content, "utf8");
      const blobHash = this.generateBlobHash(buffer);
      await this.storage.saveBlob({ hash: blobHash, content: buffer, size: buffer.length });
      blobMap[filePath] = blobHash;
    }
    const treeHash = this.computeTreeHashWithBlobs(blobMap);
    await this.storage.saveTree({ hash: treeHash, files: blobMap });
    return treeHash;
  }

  private async getCommitOrThrow(id: string): Promise<Commit> {
    const commit = await this.storage.getCommit(id);
    if (!commit) throw new Error(`Commit not found: ${id}`);
    return commit;
  }

  private async resolveCommit(ref: string): Promise<Commit> {
    const resolved = (await this.storage.resolveRef(ref)) ?? ref;
    return this.getCommitOrThrow(resolved);
  }

  private async loadTreeContents(treeHash: string): Promise<FileMap> {
    const tree = await this.storage.getTree(treeHash);
    if (!tree) throw new Error(`Tree not found: ${treeHash}`);
    const files: FileMap = {};
    for (const [filePath, blobHash] of Object.entries(tree.files)) {
      const blob = await this.storage.getBlob(blobHash);
      if (!blob) throw new Error(`Missing blob ${blobHash} for ${filePath}`);
      files[filePath] = blob.content.toString("utf8");
    }
    return files;
  }

  private async findCommonAncestor(a: string, b: string): Promise<Commit | null> {
    const ancestorsA = await this.collectAncestors(a);
    const queue: Array<{ id: string; depth: number }> = [{ id: b, depth: 0 }];
    const visited = new Set<string>();
    let best: { id: string; distance: number } | null = null;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      const distanceA = ancestorsA.get(current.id);
      if (distanceA !== undefined) {
        const total = distanceA + current.depth;
        if (!best || total < best.distance) {
          best = { id: current.id, distance: total };
        }
      }

      const commit = await this.storage.getCommit(current.id);
      if (!commit) continue;
      for (const parent of commit.parents) {
        queue.push({ id: parent, depth: current.depth + 1 });
      }
    }

    if (!best) return null;
    return this.getCommitOrThrow(best.id);
  }

  private async collectAncestors(start: string) {
    const map = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (map.has(current.id)) continue;
      map.set(current.id, current.depth);
      const commit = await this.storage.getCommit(current.id);
      if (!commit) continue;
      for (const parent of commit.parents) {
        queue.push({ id: parent, depth: current.depth + 1 });
      }
    }

    return map;
  }

  private mergeFileMaps(base: FileMap, ours: FileMap, theirs: FileMap) {
    const merged: FileMap = {};
    const conflicts: MergeConflict[] = [];
    const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);

    for (const pathName of paths) {
      const baseContent = base[pathName];
      const oursContent = ours[pathName];
      const theirsContent = theirs[pathName];

      if (oursContent === theirsContent) {
        if (oursContent !== undefined) merged[pathName] = oursContent;
        continue;
      }

      if (oursContent === baseContent) {
        if (theirsContent !== undefined) merged[pathName] = theirsContent;
        continue;
      }

      if (theirsContent === baseContent) {
        if (oursContent !== undefined) merged[pathName] = oursContent;
        continue;
      }

      conflicts.push({ path: pathName, base: baseContent, ours: oursContent, theirs: theirsContent });
    }

    return { merged, conflicts };
  }
}

export function createRepo(config: RepoConfig = {}): VCRepo {
  return new RepoImpl(config);
}

export interface LocalRepoOptions extends Omit<RepoConfig, "storage"> {
  rootDir?: string;
  storage?: never;
  sqlite?: Pick<SqliteStorageConfig, "filename">;
}

export function createLocalRepo(options: LocalRepoOptions = {}): VCRepo {
  const cwd = options.rootDir ?? process.cwd();
  const sqliteConfig: SqliteStorageConfig = {
    rootDir: path.join(cwd, ".vc"),
    filename: options.sqlite?.filename,
  };
  const storage = createSqliteStorage(sqliteConfig);
  const { sqlite: _ignored, rootDir: _ignoredRoot, ...rest } = options;
  return createRepo({ ...rest, storage });
}

function defaultHash(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}
