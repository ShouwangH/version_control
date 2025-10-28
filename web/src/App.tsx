import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommitList } from "./components/CommitList";
import { DiffViewer, type ViewMode } from "./components/DiffViewer";
import { FileList } from "./components/FileList";
import { RepoSelector } from "./components/ui/RepoSelector";
import { RepoInstructions } from "./components/ui/RepoInstructions";
import { CommitDetailPanel } from "./components/ui/CommitDetailPanel";
import { ConflictsList } from "./components/ui/ConflictsList";
import { CommitGraph } from "./components/CommitGraph";
import type {
  Commit,
  DiffEntry,
  GraphResponse,
  TreeResponse,
  ConflictEntry,
  WorkingStatePayload,
} from "./types";

const API_BASE = "/api";
const POLL_INTERVAL_MS = 5000;

type RepoListResponse = { active: string | null; repos: string[]; origin?: string | null };
type RepoSwitchResponse = { active: string; repos: string[]; origin?: string | null };
type RepoCreateResponse = { created: string; repos: string[]; origin?: string | null };

function sortCommits(commits: Commit[]): Commit[] {
  return [...commits].sort((a, b) => b.timestamp - a.timestamp);
}

function getConflicts(aiMeta: Commit["aiMeta"]): ConflictEntry[] {
  if (!aiMeta) return [];
  const maybeConflicts = (aiMeta as { conflicts?: ConflictEntry[] }).conflicts;
  return Array.isArray(maybeConflicts) ? maybeConflicts : [];
}

export default function App() {
  type WorkingState = WorkingStatePayload & { receivedAt: number };

  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [treeFiles, setTreeFiles] = useState<Record<string, string>>({});
  const [diffEntries, setDiffEntries] = useState<Record<string, DiffEntry>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("merged");
  const [statusMessage, setStatusMessage] = useState<string>("Loading repositories…");
  const [error, setError] = useState<string | null>(null);
  const [workingState, setWorkingState] = useState<WorkingState | null>(null);
  const [repoOptions, setRepoOptions] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [isSwitchingRepo, setIsSwitchingRepo] = useState<boolean>(false);
  const [isCreatingRepo, setIsCreatingRepo] = useState<boolean>(false);
  const [repoOrigin, setRepoOrigin] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"diff" | "graph">("diff");

  const commitsById = useMemo(() => {
    const map = new Map<string, Commit>();
    for (const commit of commits) {
      map.set(commit.id, commit);
    }
    return map;
  }, [commits]);

  const selectedCommit = selectedCommitId ? commitsById.get(selectedCommitId) ?? null : null;
  const conflicts = selectedCommit ? getConflicts(selectedCommit.aiMeta) : [];
  const graphRequestId = useRef(0);
  const latestCommitRef = useRef<string | null>(null);
  const followHeadRef = useRef<boolean>(true);

  const loadGraph = useCallback(
    async (options?: { reset?: boolean }) => {
      if (!selectedRepo) return;
      if (options?.reset) {
        setStatusMessage("Loading commits…");
        setCommits([]);
        setSelectedCommitId(null);
        setSelectedParentId(null);
        setTreeFiles({});
        setSelectedFile(null);
        setDiffEntries({});
        latestCommitRef.current = null;
        followHeadRef.current = true;
      }

      const requestId = ++graphRequestId.current;
      try {
        const res = await fetch(`${API_BASE}/graph`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`graph request failed: ${res.status}`);
        }
        const data = (await res.json()) as GraphResponse;
        if (graphRequestId.current !== requestId) return;
        const ordered = sortCommits(data.commits);
        const latestId = ordered[0]?.id ?? null;

        latestCommitRef.current = latestId;
        setCommits(ordered);
        setStatusMessage(ordered.length === 0 ? "No commits yet" : "");
        setError(null);

        setSelectedCommitId((current) => {
          if (!current) return latestId ?? null;
          const stillExists = ordered.some((commit) => commit.id === current);
          if (!stillExists) return latestId ?? null;
          if (followHeadRef.current && latestId && current !== latestId) {
            return latestId;
          }
          return current;
        });
      } catch (err) {
        if (graphRequestId.current !== requestId) return;
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatusMessage("Failed to load commits");
      }
    },
    [selectedRepo],
  );

  useEffect(() => {
    const latest = latestCommitRef.current;
    if (!latest) {
      followHeadRef.current = true;
      return;
    }
    followHeadRef.current = selectedCommitId === latest;
  }, [selectedCommitId]);

  useEffect(() => {
    let cancelled = false;
    async function fetchRepos() {
      try {
        const res = await fetch(`${API_BASE}/repos`);
        if (!res.ok) throw new Error(`repo list request failed: ${res.status}`);
        const data = (await res.json()) as RepoListResponse;
        if (cancelled) return;
        const uniqueRepos = Array.from(new Set(data.repos)).sort((a, b) => a.localeCompare(b));
        setRepoOptions(uniqueRepos);
        setRepoOrigin(data.origin ?? null);
        const initialRepo = data.active ?? uniqueRepos[0] ?? null;
        setSelectedRepo(initialRepo);
        setStatusMessage(initialRepo ? "Loading commits…" : "No repositories available");
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatusMessage("Failed to load repositories");
      }
    }

    fetchRepos();
    return () => {
      cancelled = true;
    };
  }, []);

useEffect(() => {
  if (!selectedRepo) {
    setCommits([]);
    setSelectedCommitId(null);
    setSelectedParentId(null);
    setTreeFiles({});
    setSelectedFile(null);
    setDiffEntries({});
    setStatusMessage(repoOptions.length === 0 ? "No repositories available" : "Select a repository");
    latestCommitRef.current = null;
    followHeadRef.current = true;
    setWorkspaceView("diff");
    return;
  }

  void loadGraph({ reset: true });
}, [selectedRepo, repoOptions, loadGraph]);

useEffect(() => {
  if (!selectedRepo) return;
  const timer = window.setInterval(() => {
    void loadGraph();
  }, POLL_INTERVAL_MS);
  return () => window.clearInterval(timer);
}, [selectedRepo, loadGraph]);

useEffect(() => {
  if (!selectedRepo) {
    setWorkingState(null);
    return;
  }

  let isCancelled = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function fetchWorkingState() {
    try {
      const res = await fetch(`${API_BASE}/working`, { cache: "no-store" });
      if (!res.ok) throw new Error(`working request failed: ${res.status}`);
      const data = (await res.json()) as WorkingStatePayload;
      if (!isCancelled) {
        setWorkingState({ ...data, receivedAt: Date.now() });
      }
    } catch (err) {
      if (!isCancelled) {
        console.error(err);
      }
    }
  }

  fetchWorkingState();
  timer = setInterval(fetchWorkingState, POLL_INTERVAL_MS);

  return () => {
    isCancelled = true;
    if (timer) clearInterval(timer);
  };
}, [selectedRepo]);

  const handleRepoSelect = async (name: string) => {
    if (!name || name === selectedRepo) return;
    setIsSwitchingRepo(true);
    setWorkspaceView("diff");
    setStatusMessage("Loading commits…");
    setCommits([]);
    setSelectedCommitId(null);
    setSelectedParentId(null);
    setTreeFiles({});
    setSelectedFile(null);
    setDiffEntries({});
    setWorkingState(null);
    try {
      const res = await fetch(`${API_BASE}/repos/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`switch repo failed: ${res.status}`);
      const data = (await res.json()) as RepoSwitchResponse;
      setRepoOptions(Array.from(new Set(data.repos)).sort((a, b) => a.localeCompare(b)));
      setRepoOrigin(data.origin ?? null);
      setSelectedRepo(data.active);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setStatusMessage("Failed to switch repository");
    } finally {
      setIsSwitchingRepo(false);
    }
  };

  const handleCreateRepo = async () => {
    if (isCreatingRepo) return;
    if (typeof window === "undefined") return;
    const input = window.prompt("Enter a name for the new repository:");
    const name = input?.trim();
    if (!name) return;
    setIsCreatingRepo(true);
    setStatusMessage("Creating repository…");
    try {
      const res = await fetch(`${API_BASE}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) {
        setError("Repository already exists");
        setStatusMessage("Repository already exists");
        return;
      }
      if (!res.ok) {
        throw new Error(`create repo failed: ${res.status}`);
      }
      const data = (await res.json()) as RepoCreateResponse;
      const uniqueRepos = Array.from(new Set(data.repos)).sort((a, b) => a.localeCompare(b));
      setRepoOptions(uniqueRepos);
      setRepoOrigin(data.origin ?? null);
      setError(null);
      await handleRepoSelect(data.created);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setStatusMessage("Failed to create repository");
    } finally {
      setIsCreatingRepo(false);
    }
  };

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
  const matchesWorkingTree =
    !!workingState && !!selectedCommit && workingState.treeHash === selectedCommit.treeHash;
  const repoSelectDisabled = repoOptions.length === 0 || isSwitchingRepo || isCreatingRepo;
  const parentOptions = selectedCommit?.parents ?? [];
  const repoLinkCommand = useMemo(() => {
    if (!selectedRepo || !repoOrigin) return "";
    return `vc remote add ${selectedRepo} --remote ${repoOrigin}`;
  }, [selectedRepo, repoOrigin]);
  const hasCommits = commits.length > 0;
  const showRepoInstructions = repoLinkCommand !== "" && commits.length === 0;
  const workspaceContent =
    workspaceView === "graph" ? (
      <section className="workspace graph-view">
        <CommitGraph commits={commits} selectedId={selectedCommitId} onSelect={setSelectedCommitId} />
      </section>
    ) : selectedCommit ? (
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
            isWorkingTree={matchesWorkingTree}
          />
        </div>
      </section>
    ) : (
      <div className="empty-state">Select a commit to inspect details.</div>
    );

  return (
    <div className="app-shell">
      <aside>
        <header>
          <h1>vc-core viewer</h1>
          <p>Inspect commits, merged output, and conflicts from the demo server.</p>
        </header>
        {error ? <div className="error-banner">{error}</div> : null}
        {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}
        <CommitList
          commits={commits}
          selectedId={selectedCommitId}
          onSelect={setSelectedCommitId}
          workingTreeHash={workingState?.treeHash ?? null}
        />
      </aside>
      <main>
        <RepoSelector
          repoOptions={repoOptions}
          selectedRepo={selectedRepo}
          disabled={repoSelectDisabled}
          isCreating={isCreatingRepo}
          isSwitching={isSwitchingRepo}
          onSelectRepo={handleRepoSelect}
          onCreateRepo={handleCreateRepo}
        />
        {showRepoInstructions ? <RepoInstructions command={repoLinkCommand} /> : null}
        {hasCommits ? (
          <>
            {selectedCommit ? (
              <>
                <CommitDetailPanel
                  commit={selectedCommit}
                  parentOptions={parentOptions}
                  selectedParentId={selectedParentId}
                  onChangeParent={setSelectedParentId}
                />
                <ConflictsList conflicts={conflicts} />
              </>
            ) : null}
            <div className="workspace-controls">
              <div className="workspace-toggle">
                <button
                  type="button"
                  className={`workspace-toggle-button${workspaceView === "diff" ? " active" : ""}`}
                  onClick={() => setWorkspaceView("diff")}
                >
                  Directory View
                </button>
                <button
                  type="button"
                  className={`workspace-toggle-button${workspaceView === "graph" ? " active" : ""}`}
                  onClick={() => setWorkspaceView("graph")}
                >
                  Visualizer
                </button>
              </div>
            </div>
            {workspaceContent}
          </>
        ) : (
          <div className="empty-state">No commits yet.</div>
        )}
      </main>
    </div>
  );
}
