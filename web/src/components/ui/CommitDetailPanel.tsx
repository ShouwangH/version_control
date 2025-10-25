import type { Commit } from "../../types";

interface CommitDetailPanelProps {
  commit: Commit;
  parentOptions: string[];
  selectedParentId: string | null;
  onChangeParent: (value: string | null) => void;
}

export function CommitDetailPanel({ commit, parentOptions, selectedParentId, onChangeParent }: CommitDetailPanelProps) {
  return (
    <section className="commit-detail">
      <div>
        <h2>{commit.message}</h2>
        <div className="commit-meta-inline">
          <span>Author: {commit.author}</span>
          <span>Source: {commit.source}</span>
          <span>{new Date(commit.timestamp).toLocaleString()}</span>
        </div>
      </div>
      <div className="parent-select">
        {parentOptions.length > 0 ? (
          <label>
            Compare to parent:
            <select
              value={selectedParentId ?? ""}
              onChange={(event) => onChangeParent(event.target.value || null)}
            >
              {parentOptions.map((parentId) => (
                <option key={parentId} value={parentId}>
                  {parentId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>No parents</span>
        )}
      </div>
    </section>
  );
}
