import type { FormEvent } from "react";

interface RepoSelectorProps {
  repoOptions: string[];
  selectedRepo: string | null;
  disabled: boolean;
  isCreating: boolean;
  isSwitching: boolean;
  onSelectRepo: (name: string) => void;
  onCreateRepo: () => void;
}

export function RepoSelector({
  repoOptions,
  selectedRepo,
  disabled,
  isCreating,
  isSwitching,
  onSelectRepo,
  onCreateRepo,
}: RepoSelectorProps) {
  const handleChange = (event: FormEvent<HTMLSelectElement>) => {
    onSelectRepo(event.currentTarget.value);
  };

  if (repoOptions.length === 0) {
    return (
      <div className="commit-parents">
        <div className="repo-empty-state">
          <span>No repositories available</span>
          <button className="primary-button" onClick={onCreateRepo} disabled={isCreating}>
            Create one
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="commit-parents">
      <label>
        Repository:
        <select value={selectedRepo ?? ""} onChange={handleChange} disabled={disabled}>
          {!selectedRepo ? (
            <option value="" disabled>
              Select a repository
            </option>
          ) : null}
          {repoOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary-button small"
        onClick={onCreateRepo}
        disabled={isCreating || isSwitching}
      >
        New Repo
      </button>
    </div>
  );
}
