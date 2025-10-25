import type { Commit } from "../types";

interface CommitListProps {
  commits: Commit[];
  selectedId: string | null;
  onSelect: (commitId: string) => void;
  workingTreeHash?: string | null;
}

export function CommitList({ commits, selectedId, onSelect, workingTreeHash = null }: CommitListProps) {
  return (
    <div className="commit-list">
      {commits.map((commit) => {
        const selected = commit.id === selectedId;
        const matchesWorking = !!workingTreeHash && commit.treeHash === workingTreeHash;
        const shortId = commit.id.slice(0, 8);
        const date = new Date(commit.timestamp);
        const classNames = ["commit-item"];
        if (selected) classNames.push("selected");
        if (matchesWorking) classNames.push("working");
        return (
          <button
            key={commit.id}
            className={classNames.join(" ")}
            onClick={() => onSelect(commit.id)}
          >
            <div className="commit-id">
              <span>{shortId}</span>
              <span className="commit-source">{commit.source}</span>
            </div>
            <div className="commit-message">{commit.message}</div>
            <div className="commit-meta">
              <span>{commit.author}</span>
              <span>{date.toLocaleString()}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
