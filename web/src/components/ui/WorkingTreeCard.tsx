interface WorkingTreeCardProps {
  selectedRepo: string | null;
  treeHash: string;
  parentId: string | null;
  filesTracked: number;
  updatedAt: number;
  matchesWorkingTree: boolean;
  formatRelativeTime: (timestamp: number) => string;
  shortId: (value: string | null | undefined) => string;
}

export function WorkingTreeCard({
  selectedRepo,
  treeHash,
  parentId,
  filesTracked,
  updatedAt,
  matchesWorkingTree,
  formatRelativeTime,
  shortId,
}: WorkingTreeCardProps) {
  return (
    <div className={`working-state-card${matchesWorkingTree ? " in-sync" : ""}`}>
      <h3>Working Tree</h3>
      <p>Repository: {selectedRepo ?? "n/a"}</p>
      <p>Tree: {shortId(treeHash)}</p>
      <p>Parent: {shortId(parentId)}</p>
      <p>Files tracked: {filesTracked}</p>
      <p>Updated {formatRelativeTime(updatedAt)}</p>
    </div>
  );
}
