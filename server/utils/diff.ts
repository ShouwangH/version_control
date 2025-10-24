import { createTwoFilesPatch, diffLines } from "diff";

export interface FileDiffSummary {
  adds: number;
  dels: number;
  patch: string;
}

export function summarizeDiff(path: string, a: string, b: string): FileDiffSummary {
  const parts = diffLines(a, b);
  let adds = 0;
  let dels = 0;
  for (const p of parts) {
    if (p.added) adds += p.count ?? 0;
    if (p.removed) dels += p.count ?? 0;
  }
  const patch = createTwoFilesPatch(path, path, a, b);
  return { adds, dels, patch };
}
