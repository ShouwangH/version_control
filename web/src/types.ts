export interface Commit {
  id: string;
  parents: string[];
  treeHash: string;
  message: string;
  author: string;
  source: string;
  aiMeta: Record<string, unknown> | null;
  timestamp: number;
}

export interface GraphResponse {
  commits: Commit[];
  refs: Record<string, string>;
}

export interface TreeResponse {
  files: Record<string, string>;
}

export interface DiffEntry {
  adds: number;
  dels: number;
  patch: string;
  before: string;
  after: string;
}

export interface DiffResponse {
  perFile: Record<string, DiffEntry>;
}

export interface ConflictEntry {
  path: string;
  base?: string;
  ours?: string;
  theirs?: string;
}
