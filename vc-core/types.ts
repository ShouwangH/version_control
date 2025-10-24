export type CommitSource = "human" | "ai" | "system";

export interface Commit {
  id: string;
  parents: string[];
  treeHash: string;
  message: string;
  author: string;
  source: CommitSource;
  aiMeta?: Record<string, unknown> | null;
  timestamp: number;
}

export interface WorkingState {
  parentId: string | null;
  treeHash: string;
}

export interface FileMap {
  [path: string]: string;
}

export interface MergeConflict {
  path: string;
  base?: string;
  ours?: string;
  theirs?: string;
}

export interface MergeResult {
  mergedTreeHash: string | null;
  conflicts: MergeConflict[];
  mergedFiles?: FileMap | null;
  commitId?: string | null;
}

export interface SerializedBlob {
  hash: string;
  content: string;
  size: number;
}

export interface TreeSnapshot {
  hash: string;
  files: Record<string, string>;
}

export interface RepoSnapshot {
  commits: Commit[];
  trees: TreeSnapshot[];
  blobs: SerializedBlob[];
  refs: Record<string, string>;
}

export interface VCRepo {
  init(): Promise<void>;
  getWorking(): Promise<WorkingState>;
  snapshot(files: FileMap): Promise<WorkingState>;
  commit(message: string, source: CommitSource, aiMeta?: Record<string, unknown> | null): Promise<Commit>;
  hydrate(ref: string): Promise<FileMap>;
  merge(ref: string): Promise<MergeResult>;
  log(): Promise<Commit[]>;
  exportSnapshot(): Promise<RepoSnapshot>;
  importSnapshot(snapshot: RepoSnapshot): Promise<void>;
}
