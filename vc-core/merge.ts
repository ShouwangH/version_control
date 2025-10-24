import { MergeConflict, MergeResult } from "./types";

export interface MergeInput {
  baseTree: string;
  oursTree: string;
  theirsTree: string;
}

export function mergeTrees(_input: MergeInput): MergeResult {
  const conflicts: MergeConflict[] = [];
  return { mergedTreeHash: null, conflicts };
}
