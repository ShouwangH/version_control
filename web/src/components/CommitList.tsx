import type { Commit } from "../types";

interface CommitListProps {
  commits: Commit[];
  selectedId: string | null;
  onSelect: (commitId: string) => void;
}

export function CommitList({ commits, selectedId, onSelect }: CommitListProps) {
  return (
    <div className="commit-list">
      {commits.map((commit) => {
        const selected = commit.id === selectedId;
        const shortId = commit.id.slice(0, 8);
        const date = new Date(commit.timestamp);
        return (
          <button
            key={commit.id}
            className={`commit-item${selected ? " selected" : ""}`}
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
