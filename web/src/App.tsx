import { useEffect, useMemo, useState } from "react";
import { CommitList } from "./components/CommitList";
import { DiffViewer, type ViewMode } from "./components/DiffViewer";
import { FileList } from "./components/FileList";
import type { Commit, DiffEntry, GraphResponse, TreeResponse, ConflictEntry } from "./types";

const API_BASE = "/api";

function sortCommits(commits: Commit[]): Commit[] {
  return [...commits].sort((a, b) => b.timestamp - a.timestamp);
}

function getConflicts(aiMeta: Commit["aiMeta"]): ConflictEntry[] {
  if (!aiMeta) return [];
  const maybeConflicts = (aiMeta as { conflicts?: ConflictEntry[] }).conflicts;
  return Array.isArray(maybeConflicts) ? maybeConflicts : [];
}

export default function App() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [treeFiles, setTreeFiles] = useState<Record<string, string>>({});
  const [diffEntries, setDiffEntries] = useState<Record<string, DiffEntry>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("merged");
  const [statusMessage, setStatusMessage] = useState<string>("Loading commits…");
  const [error, setError] = useState<string | null>(null);

  const commitsById = useMemo(() => {
    const map = new Map<string, Commit>();
    for (const commit of commits) {
      map.set(commit.id, commit);
    }
    return map;
  }, [commits]);

  const selectedCommit = selectedCommitId ? commitsById.get(selectedCommitId) ?? null : null;
  const conflicts = selectedCommit ? getConflicts(selectedCommit.aiMeta) : [];

  useEffect(() => {
    async function loadGraph() {
      try {
        const res = await fetch(`${API_BASE}/graph`);
        if (!res.ok) throw new Error(`graph request failed: ${res.status}`);
        const data = (await res.json()) as GraphResponse;
        const ordered = sortCommits(data.commits);
        setCommits(ordered);
        const initial = ordered[0]?.id ?? null;
        setSelectedCommitId(initial);
        setStatusMessage(ordered.length === 0 ? "No commits yet" : "");
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatusMessage("Failed to load commits");
      }
    }
    loadGraph();
  }, []);

  useEffect(() => {
    if (!selectedCommit) return;
    const parents = selectedCommit.parents;
    if (parents.length === 0) {
      setSelectedParentId(null);
      setDiffEntries({});
      return;
    }
    setSelectedParentId((current) => {
      if (current && parents.includes(current)) {
        return current;
      }
      return parents[0] ?? null;
    });
  }, [selectedCommit]);

  useEffect(() => {
    async function loadTree(commit: Commit) {
      try {
        const res = await fetch(`${API_BASE}/tree/${commit.treeHash}`);
        if (!res.ok) throw new Error(`tree request failed: ${res.status}`);
        const data = (await res.json()) as TreeResponse;
        setTreeFiles(data.files);
        const paths = Object.keys(data.files).sort();
        setSelectedFile((current) => {
          if (current && paths.includes(current)) return current;
          return paths[0] ?? null;
        });
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    if (selectedCommit) {
      loadTree(selectedCommit);
    } else {
      setTreeFiles({});
      setSelectedFile(null);
    }
  }, [selectedCommit]);

  useEffect(() => {
    async function loadDiff(commit: Commit, parentId: string) {
      const parent = commitsById.get(parentId);
      if (!parent) {
        console.warn("Missing parent commit for diff", parentId);
        setDiffEntries({});
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/diff`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ olderTreeHash: parent.treeHash, newerTreeHash: commit.treeHash }),
        });
        if (!res.ok) throw new Error(`diff request failed: ${res.status}`);
        const data = (await res.json()) as { perFile: Record<string, DiffEntry> };
        setDiffEntries(data.perFile);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setDiffEntries({});
      }
    }

    if (selectedCommit && selectedParentId) {
      loadDiff(selectedCommit, selectedParentId);
    } else if (selectedCommit && !selectedParentId) {
      setDiffEntries({});
    }
  }, [selectedCommit, selectedParentId, commitsById]);

  const fileNames = useMemo(() => Object.keys(treeFiles).sort(), [treeFiles]);
  const mergedContent = selectedFile ? treeFiles[selectedFile] ?? null : null;
  const diffEntry = selectedFile ? diffEntries[selectedFile] ?? null : null;
  const parentOptions = selectedCommit?.parents ?? [];

  return (
    <div className="app-shell">
      <aside>
        <header>
          <h1>vc-core viewer</h1>
          <p>Inspect commits, merged output, and conflicts from the demo server.</p>
        </header>
        {error ? <div className="error-banner">{error}</div> : null}
        {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}
        <CommitList commits={commits} selectedId={selectedCommitId} onSelect={setSelectedCommitId} />
      </aside>
      <main>
        {selectedCommit ? (
          <>
            <section className="commit-detail">
              <div>
                <h2>{selectedCommit.message}</h2>
                <div className="commit-meta-inline">
                  <span>Author: {selectedCommit.author}</span>
                  <span>Source: {selectedCommit.source}</span>
                  <span>{new Date(selectedCommit.timestamp).toLocaleString()}</span>
                </div>
              </div>
              <div className="commit-parents">
                {parentOptions.length > 0 ? (
                  <label>
                    Compare to parent:
                    <select
                      value={selectedParentId ?? ""}
                      onChange={(event) => setSelectedParentId(event.target.value || null)}
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

            {conflicts.length > 0 ? (
              <section className="conflicts">
                <h3>Conflicts</h3>
                <ul>
                  {conflicts.map((conflict) => (
                    <li key={conflict.path}>
                      <strong>{conflict.path}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="workspace">
              <div className="file-column">
                <h3>Files</h3>
                <FileList files={fileNames} selected={selectedFile} onSelect={setSelectedFile} />
              </div>
              <div className="viewer-column">
                <DiffViewer
                  fileName={selectedFile}
                  entry={diffEntry}
                  mergedContent={mergedContent}
                  viewMode={viewMode}
                  onChangeView={setViewMode}
                />
              </div>
            </section>
          </>
        ) : (
          <div className="empty-state">Select a commit to inspect details.</div>
        )}
      </main>
    </div>
  );
}
