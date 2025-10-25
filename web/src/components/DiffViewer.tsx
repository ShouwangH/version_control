import { useMemo } from "react";
import type { DiffEntry } from "../types";

type ViewMode = "merged" | "before" | "after" | "patch";

interface DiffViewerProps {
  fileName: string | null;
  entry: DiffEntry | null;
  mergedContent: string | null;
  viewMode: ViewMode;
  onChangeView: (mode: ViewMode) => void;
  isWorkingTree: boolean;
}

const VIEW_TABS: Array<{ key: ViewMode; label: string }> = [
  { key: "merged", label: "Merged" },
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
  { key: "patch", label: "Patch" },
];

export function DiffViewer({
  fileName,
  entry,
  mergedContent,
  viewMode,
  onChangeView,
  isWorkingTree,
}: DiffViewerProps) {
  const content = useMemo(() => {
    if (!entry) {
      return mergedContent ?? "";
    }
    switch (viewMode) {
      case "merged":
        return mergedContent ?? entry.after;
      case "before":
        return entry.before;
      case "after":
        return entry.after;
      case "patch":
        return entry.patch;
      default:
        return entry.after;
    }
  }, [entry, mergedContent, viewMode]);

  const stats =
    entry && viewMode !== "patch"
      ? `+${entry.adds} / -${entry.dels}`
      : entry && viewMode === "patch"
        ? "Raw patch"
        : "";

  const viewerClassName = isWorkingTree ? "diff-viewer working" : "diff-viewer";

  const lines = useMemo(() => {
    const parts = content.split(/\r?\n/);
    if (content.endsWith("\n")) {
      parts.push("");
    }
    return parts;
  }, [content]);

  const lineClass = (line: string) => {
    if (viewMode === "patch") {
      if (line.startsWith("@@")) return "diff-line hunk";
      if (line.startsWith("+")) return "diff-line added";
      if (line.startsWith("-")) return "diff-line removed";
      if (line.startsWith("Index:") || line.startsWith("---") || line.startsWith("+++")) {
        return "diff-line meta";
      }
      return "diff-line";
    }

    if (line.startsWith("<<<<<<<")) return "diff-line conflict-start";
    if (line.startsWith("=======")) return "diff-line conflict-mid";
    if (line.startsWith(">>>>>>>")) return "diff-line conflict-end";
    return "diff-line";
  };

  const diffContentClass = viewMode === "patch" ? "diff-content patch-view" : "diff-content";

  return (
    <div className={viewerClassName}>
      <div className="diff-header">
        <div>
          <h2>{fileName ?? "Select a file"}</h2>
          {stats ? <span className="diff-stats">{stats}</span> : null}
        </div>
        <div className="diff-header-right">
          {isWorkingTree ? <span className="working-pill">Working tree</span> : null}
          <div className="diff-tabs">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                className={tab.key === viewMode ? "active" : ""}
                onClick={() => onChangeView(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={diffContentClass}>
        {lines.length === 0 ? (
          <div className="diff-line">
            <span className="diff-text muted">No content</span>
          </div>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={lineClass(line)}>
              <span className="diff-text">{line === "" ? "\u00A0" : line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export type { ViewMode };
