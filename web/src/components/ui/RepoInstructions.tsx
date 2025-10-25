interface RepoInstructionsProps {
  command: string;
}

export function RepoInstructions({ command }: RepoInstructionsProps) {
  if (!command) return null;
  return (
    <section className="repo-instructions">
      <h2>Link your local repository</h2>
      <p>Run these commands from your project directory to start pushing:</p>
      <pre>
        <code>{command}</code>
        {"\n"}
        <code>vc push</code>
      </pre>
      <p className="hint">After the first push, your commits will appear here automatically.</p>
    </section>
  );
}
