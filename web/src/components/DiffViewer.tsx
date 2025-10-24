import { useMemo } from "react";
import type { DiffEntry } from "../types";

type ViewMode = "merged" | "before" | "after" | "patch";

interface DiffViewerProps {
  fileName: string | null;
  entry: DiffEntry | null;
  mergedContent: string | null;
  viewMode: ViewMode;
  onChangeView: (mode: ViewMode) => void;
}

const VIEW_TABS: Array<{ key: ViewMode; label: string }> = [
  { key: "merged", label: "Merged" },
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
  { key: "patch", label: "Patch" },
];

export function DiffViewer({ fileName, entry, mergedContent, viewMode, onChangeView }: DiffViewerProps) {
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

  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <div>
          <h2>{fileName ?? "Select a file"}</h2>
          {stats ? <span className="diff-stats">{stats}</span> : null}
        </div>
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
      <pre className="diff-content">{content}</pre>
    </div>
  );
}

export type { ViewMode };
