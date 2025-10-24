interface FileListProps {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export function FileList({ files, selected, onSelect }: FileListProps) {
  return (
    <div className="file-list">
      {files.map((path) => {
        const isActive = path === selected;
        return (
          <button key={path} className={isActive ? "active" : ""} onClick={() => onSelect(path)}>
            {path}
          </button>
        );
      })}
    </div>
  );
}
