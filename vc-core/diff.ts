export interface DiffEntry {
  path: string;
  adds: number;
  dels: number;
}

export interface DiffResult {
  entries: DiffEntry[];
}

export function diffTrees(_olderTreeHash: string, _newerTreeHash: string): DiffResult {
  // Placeholder implementation – real diffing will land in a later milestone.
  return { entries: [] };
}
