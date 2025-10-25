import type { ConflictEntry } from "../../types";

interface ConflictsListProps {
  conflicts: ConflictEntry[];
}

export function ConflictsList({ conflicts }: ConflictsListProps) {
  if (conflicts.length === 0) return null;
  return (
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
  );
}
