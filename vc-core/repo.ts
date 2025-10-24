import { createHash } from "crypto";
import path from "node:path";
import { createInMemoryStorage, createSqliteStorage } from "./storage";
import type { StorageAdapter, SqliteStorageConfig } from "./storage";
import type { Commit, CommitSource, FileMap, MergeResult, VCRepo, WorkingState } from "./types";

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
    const blobMap: FileMap = {};

    for (const [filePath, content] of entries) {
      const buffer = Buffer.from(content, "utf8");
      const blobHash = this.generateBlobHash(buffer);
      await this.storage.saveBlob({ hash: blobHash, content: buffer, size: buffer.length });
      blobMap[filePath] = blobHash;
    }

    const treeHash = this.computeTreeHashWithBlobs(blobMap);
    await this.storage.saveTree({ hash: treeHash, files: blobMap });

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

  async merge(_ref: string): Promise<MergeResult> {
    throw new Error("merge is not implemented yet");
  }

  async log(): Promise<Commit[]> {
    await this.ensureReady();
    return this.storage.listCommits();
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

  private async resolveCommit(ref: string): Promise<Commit> {
    const resolved = (await this.storage.resolveRef(ref)) ?? ref;
    const commit = await this.storage.getCommit(resolved);
    if (!commit) {
      throw new Error(`Unknown ref or commit: ${ref}`);
    }
    return commit;
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
