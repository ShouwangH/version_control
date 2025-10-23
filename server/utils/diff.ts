import { diffLines } from "diff";

export function summarizeDiff(a: string, b: string) {
  const parts = diffLines(a, b);
  let adds = 0;
  let dels = 0;
  for (const p of parts) {
    if (p.added) adds += p.count ?? 0;
    if (p.removed) dels += p.count ?? 0;
  }
  return { adds, dels };
}
